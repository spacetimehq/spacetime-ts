import { Client } from './Client'
import { wrapError, PolybaseError } from './errors'
import { Request, SenderResponse } from './types'

export type SubscriptionFn<T> = ((data: T) => void)
export type SubscriptionErrorFn = ((err: PolybaseError) => void)
export type UnsubscribeFn = (() => void)

export interface SubscriptionOptions {
  /**
  * Default timeout between long poll requests.
   */
  timeout: number
  /**
  * Max timeout after error backoff.
   */
  maxErrorTimeout: number
}

const defaultOptions: SubscriptionOptions = {
  timeout: 100,
  maxErrorTimeout: 60 * 1000,
}

export interface Listener<T> {
  fn: SubscriptionFn<T>
  errFn?: SubscriptionErrorFn
}

export type TransformerFn<T, R = any> = (res: SenderResponse<R>) => Promise<T> | T

export class Subscription<T, R = any> {
  private _listeners: Listener<T>[]
  private req: Request
  private client: Client
  private since?: string
  private aborter?: () => void
  private _stopped = true
  private options: SubscriptionOptions
  private errors = 0
  private data?: T
  private timer?: number
  private id = 0
  private isPublicallyAccessible: Promise<boolean>
  private transformer: TransformerFn<T, R>

  constructor(req: Request, client: Client, isPublicallyAccessible: Promise<boolean>, transformer: TransformerFn<T, R>, options?: Partial<SubscriptionOptions>) {
    this.req = req
    this.client = client
    this.isPublicallyAccessible = isPublicallyAccessible ?? false
    this.transformer = transformer
    this._listeners = []
    this.options = Object.assign({}, defaultOptions, options)
  }

  tick = async (id?: number) => {
    if (this._stopped || id !== this.id) return

    const params = this.req.params ? { ...this.req.params } : {}
    if (this.since && this.data) {
      params.since = `${this.since}`
    }

    try {
      const req = this.client.request({
        ...this.req,
        params,
      })
      this.aborter = req.abort

      const sixtyMinutes = 60 * 60 * 1000
      const isPubliclyAccessible = await this.isPublicallyAccessible
      const res = await req.send(isPubliclyAccessible ? 'none' : 'required', sixtyMinutes)

      this.since = res.headers['x-polybase-timestamp'] ?? `${Date.now() / 1000}`

      this.data = await this.transformer(res)

      this._listeners.forEach(({ fn }) => {
        if (this.data) fn(this.data)
      })
    } catch (err: any) {
      // Get the status code from the error
      const statusCode = err.statusCode ?? err.status ??
        err.code ?? err.response?.status

      const isCancelledError = err && typeof err === 'object' &&
        err instanceof PolybaseError && err.reason === 'request/cancelled'

      // Don't error for 304
      if (statusCode !== 304 && !isCancelledError) {
        let e = err
        if (!(err instanceof PolybaseError)) {
          e = wrapError(err)
        }

        // Send error to listeners
        this._listeners.forEach(({ errFn }) => {
          if (errFn) errFn(e)
        })

        // Also log to console
        // console.error(err)

        this.errors += 1

        // Longer timeout before next tick if we
        //  received an error
        const errTimeout = Math.min(
          1000 * this.errors,
          this.options.maxErrorTimeout,
        )
        this.timer = setTimeout(() => {
          this.tick(id)
        }, errTimeout) as unknown as number

        return
      }
    }

    this.errors = 0

    // If no since has been stored, then we need to wait longer
    // because
    this.timer = setTimeout(() => {
      this.tick(id)
    }, this.options.timeout) as unknown as number
  }

  subscribe = (fn: SubscriptionFn<T>, errFn?: SubscriptionErrorFn) => {
    const l = { fn, errFn }
    this._listeners.push(l)
    if (this.data) {
      fn(this.data)
    }
    this.start()
    return () => {
      const index = this._listeners.indexOf(l)

      // Already removed, shouldn't happen
      if (index === -1) return

      // Remove the listener
      this._listeners.splice(index, 1)

      // Stop if no more listeners
      if (this._listeners.length === 0) {
        this.stop()
      }
    }
  }

  start = () => {
    if (this._stopped) {
      this._stopped = false
      this.id += 1
      this.tick(this.id)
    }
  }

  // TODO: prevent race conditions by waiting for abort
  // before allowing start again
  stop = () => {
    this._stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.since = undefined
    if (this.aborter) this.aborter()
  }

  get listeners() {
    return this._listeners
  }

  get stopped() {
    return this._stopped
  }
}
