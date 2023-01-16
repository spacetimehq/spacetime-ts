import { createError, createErrorFromAxiosError, PolybaseError } from './errors'
import { RequestConfig } from './request'
import { BasicValue, Request, RequestParams, Sender, SenderResponse, Signer } from './types'

export interface ClientConfig {
  clientId: string
  baseURL: string
}

export class Client {
  private sender: Sender
  signer?: Signer
  private config?: ClientConfig

  constructor (sender: Sender, signer?: Signer, config?: ClientConfig) {
    this.sender = sender
    this.signer = signer
    this.config = config
  }

  request = (req: Request): ClientRequest => {
    return new ClientRequest(this.sender, {
      url: req.url,
      method: req.method,
      params: parseParams(req.params),
      data: req.data,
    }, this.signer, this.config)
  }
}

export class ClientRequest {
  private aborter: AbortController
  private req: Request
  private sender: Sender
  private signer?: Signer
  private config?: ClientConfig

  constructor (sender: Sender, req: Request, signer?: Signer, config?: ClientConfig) {
    this.aborter = new AbortController()
    this.req = req
    this.sender = sender
    this.signer = signer
    this.config = config
  }

  abort = () => {
    this.aborter.abort()
  }

  /* Sending a request to the server. */
  send = async (withAuth?: boolean): Promise<SenderResponse> => {
    try {
      const req = this.req as RequestConfig
      if (this.signer && withAuth) {
        const sig = await this.getSignature()
        if (sig) {
          if (!req.headers) req.headers = {}
          req.headers['X-Polybase-Signature'] = sig
        }
      }
      req.baseUrl = this.config?.baseURL
      req.clientId = this.config?.clientId ?? 'Polybase'
      const res = await this.sender(req)
      return res
    } catch (e: any) {
      console.log(e)
      if (e instanceof Error) {
        if (e.message === 'ERR_CANCELED') {
          throw createError('request/cancelled')
        }
      }
      throw (e)
    }
  }

  private getSignature = async () => {
    if (!this.signer) return ''
    const t = Math.round(Date.now() * 1000)
    const sig = await this.signer(`${t}.${this.req.data ? JSON.stringify(this.req.data) : ''}`, this.req)
    if (!sig) return null
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

export function parseParams (params?: RequestParams): Record<string, BasicValue|undefined> {
  if (!params) return {}
  return {
    ...params,
    where: params?.where ? JSON.stringify(params?.where) : undefined,
    sort: params?.sort ? JSON.stringify(params?.sort) : undefined,
  }
}
