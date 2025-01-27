
import { AxiosError, AxiosRequestConfig } from 'axios'
import { createError, createErrorFromAxiosError } from './errors'
import { QueryValue, Request, RequestParams, Sender, SenderResponse, Signer, SignerResponse } from './types'

/**
 * The Client configuration.
 */
export interface ClientConfig {
  /** The unique identifier for this client.
   * @example
   * ```
   * polybase@ts/client:v0
   * ```
  */
  clientId: string
  /** The base URL of the Polybase service.
   * @example
   * ```
   * https://testnet.polybase.xyz/v0
   * ```
   */
  baseURL: string
}

type SignatureCache = Record<string, { timeMs: number, sig: SignerResponse }>

/**
 * The Client used by the Polybase Client for interacting with the Polybase service.
 */
export class Client {
  private sender: Sender
  signer?: Signer
  private config?: ClientConfig
  private signatureCache: SignatureCache

  constructor(sender: Sender, signer?: Signer, config?: ClientConfig) {
    this.sender = sender
    this.signer = signer
    this.config = config
    this.signatureCache = {}
  }

  /**
   * Returns a new {@link ClientRequest} instance.
   */
  request = (req: Request): ClientRequest => {
    return new ClientRequest(this.sender, {
      url: req.url,
      method: req.method,
      params: parseParams(req.params),
      data: req.data,
    }, this.signatureCache, this.signer, this.config)
  }
}

export class ClientRequest {
  private aborter: AbortController
  private req: Request
  private sender: Sender
  private signer?: Signer
  private config?: ClientConfig
  private signatureCache: SignatureCache

  constructor(sender: Sender, req: Request, signatureCache: SignatureCache, signer?: Signer, config?: ClientConfig) {
    this.aborter = new AbortController()
    this.req = req
    this.sender = sender
    this.signer = signer
    this.config = config
    this.signatureCache = signatureCache
  }

  abort = () => {
    this.aborter.abort()
  }

  /**
   *  Send a request to the server.
   *
   * @param withAuth - The authentication mode.
   * @param sigExtraTimeMs - Extra time to sign the request.
   */
  send = async <T = any>(withAuth: 'none' | 'optional' | 'required', sigExtraTimeMs?: number): Promise<SenderResponse<T>> => {
    try {
      const req = this.req as AxiosRequestConfig
      // Error if we require a signer and its not set
      if (!this.signer && withAuth === 'required') {
        throw createError('request/no-signer', {
          message: 'You must add a .signer() to sign permissioned requests, see: https://polybase.xyz/docs/authentication',
        })
      }

      // Warn if signer is optional, as a signer is recommended
      if (!this.signer && withAuth === 'optional' && process.env.NODE_ENV !== 'production') {
        console.error('Add .signer() to populate ctx.publicKey, see: https://polybase.xyz/docs/authentication')
      }

      if (withAuth !== 'none' && this.signer) {
        const sig = await this.getSignature(sigExtraTimeMs || 0)
        if (sig) {
          if (!req.headers) req.headers = {}
          req.headers['X-Polybase-Signature'] = sig
        }
      }

      const res = await this.sender({
        ...req,
        headers: {
          'X-Polybase-Client': this.config?.clientId ?? 'Polybase',
          ...req.headers,
        },
        baseURL: this.config?.baseURL,
        signal: this.aborter.signal,
      })
      return res
    } catch (e: unknown) {
      if (e && typeof e === 'object' && e instanceof AxiosError) {
        if (e.code === 'ERR_CANCELED') {
          throw createError('request/cancelled')
        }
        throw createErrorFromAxiosError(e)
      }
      throw e
    }
  }

  /** @private */
  private getSignature = async (extraTimeMs: number) => {
    if (!this.signer) return ''

    let t: number
    let sig: SignerResponse

    const jsonBody = this.req.data ? JSON.stringify(this.req.data) : ''
    const cachedSignature = this.signatureCache[jsonBody]
    if (cachedSignature && cachedSignature.timeMs > Date.now()) {
      t = cachedSignature.timeMs
      sig = cachedSignature.sig
    } else {
      t = Date.now() + extraTimeMs
      const s = await this.signer(`${t}.${jsonBody}`, this.req)
      if (!s) return null

      sig = s

      if (extraTimeMs > 0) {
        this.signatureCache[jsonBody] = {
          timeMs: t,
          sig: s,
        }
      }
    }

    const h = [
      'v=0',
      `t=${t}`,
      `h=${sig.h}`,
      `sig=${sig.sig}`,
    ]
    if (sig.pk) {
      h.push(`pk=${sig.pk}`)
    }
    return h.join(',')
  }
}

/**
 * Parse the given request parameters into a {@link Record} object.
 */
export function parseParams(params?: RequestParams): Record<string, QueryValue | undefined> {
  if (!params) return {}
  return {
    ...params,
    where: params?.where ? JSON.stringify(params?.where) : undefined,
    sort: params?.sort ? JSON.stringify(params?.sort) : undefined,
  }
}
