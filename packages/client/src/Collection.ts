import { Doc } from './Doc'
import { Query } from './Query'
import { Subscription, SubscriptionFn, SubscriptionErrorFn } from './Subscription'
import { Client } from './Client'
import { BasicValue, CollectionMeta, CollectionDocument, CollectionList, QueryWhereOperator } from './types'
import { generateJSFunction, parse, Program, validateSet } from '@spacetimexyz/parser'

export class Collection<T> {
  id: string
  private querySubs: Record<string, Subscription<CollectionList<T>>> = {}
  private docSubs: Record<string, Subscription<CollectionDocument<T>>> = {}
  private meta?: CollectionMeta
  private validator?: (data: Partial<T>) => Promise<boolean>
  private client: Client

  // TODO: this will be fetched
  constructor (id: string, client: Client) {
    this.id = id
    this.client = client
  }

  load = async () => {
    await Promise.all([
      this.getValidator(),
    ])
  }

  getMeta = async () => {
    try {
      if (this.meta) return this.meta
      const res = await this.client.request({
        url: `/data/$collections/${encodeURIComponent(this.id)}`,
        method: 'GET',
      }).send()
      this.meta = res.data?.data as CollectionMeta
      return this.meta
    } catch (e) {
      // TODO: handle missing collection
      throw new Error('Unable to fetch metadata')
    }
  }

  private shortName = () => this.id.split('/').pop()

  private collectionAST = (ast: Program) => {
    return ast.nodes.find(c => c.Collection?.name === this.shortName())?.Collection
  }

  private getValidator = async (): Promise<(data: Partial<T>) => Promise<boolean>> => {
    if (this.validator) return this.validator

    const meta = await this.getMeta()
    const ast = await parse(meta.code)
    this.validator = async (data: Partial<T>) => {
      try {
        await validateSet(this.collectionAST(ast), data)
        return true
      } catch {
        return false
      }
    }

    return this.validator
  }

  validate = async (data: Partial<T>) => {
    const validator = await this.getValidator()
    return await validator(data)
  }

  get = async (): Promise<CollectionList<T>> => {
    const res = await this.client.request({
      url: `/data/${encodeURIComponent(this.id)}`,
      method: 'GET',
    }).send()

    return res.data
  }

  call = async (functionName: string, args: (string | number | Doc<any>)[] = [], pk?: string): Promise<CollectionDocument<any>[]> => {
    const meta = await this.getMeta()
    const ast = await parse(meta.code)
    const funcAST = this.collectionAST(ast).items.find((f: any) => f?.Function?.name === functionName)?.Function
    if (!funcAST) throw new Error('Function not found')

    for (const param in funcAST.parameters) {
      const ourArg = args[param as any]
      const expectedType = funcAST.parameters[param as any].type_
      switch (expectedType) {
        case 'String':
          if (typeof ourArg !== 'string') throw new Error(`Argument ${param} must be a string`)
          break
        case 'Number':
          if (typeof ourArg !== 'number') throw new Error(`Argument ${param} must be a number`)
          break
        case 'Record':
          if (!(ourArg instanceof Doc)) throw new Error(`Argument ${param} must be a record`)
          break
      }
    }

    let resolvedArgs = []
    for (const arg of args) {
      if (arg instanceof Doc) {
        resolvedArgs.push(arg.get().then(d => d.data))
      } else {
        resolvedArgs.push(arg)
      }
    }
    resolvedArgs = await Promise.all(resolvedArgs)

    const auth = {
      publicKey: pk,
    }

    const js = await generateJSFunction(funcAST)
    // eslint-disable-next-line no-eval
    const changedArgs = eval(`${js.code}; const auth = ${JSON.stringify(auth)}; const args = ${JSON.stringify(resolvedArgs)}; f(auth, args); args`)

    await this.client.request({
      url: `/call/${encodeURIComponent(this.id)}/${encodeURIComponent(functionName)}`,
      method: 'POST',
      data: {
        args: args.map(arg => {
          if (arg instanceof Doc) {
            return { id: arg.id }
          }

          return arg
        }),
        result: JSON.stringify(changedArgs),
      },
    }).send(pk ? true : undefined)

    return changedArgs.filter((arg: any) => typeof arg === 'object')
  }

  doc = (id: string): Doc<T> => {
    return new Doc<T>(id, this, this.client, this.onDocSnapshotRegister)
  }

  where = (field: string, op: QueryWhereOperator, value: BasicValue): Query<T> => {
    return this.createQuery().where(field, op, value)
  }

  sort = (field: string, direction?: 'asc'|'desc'): Query<T> => {
    return this.createQuery().sort(field, direction)
  }

  limit = (limit: number): Query<T> => {
    return this.createQuery().limit(limit)
  }

  onSnapshot = (fn: SubscriptionFn<CollectionList<T>>) => {
    return this.createQuery().onSnapshot(fn)
  }

  after = (cursor: string): Query<T> => {
    return this.createQuery().after(cursor)
  }

  before = (cursor: string): Query<T> => {
    return this.createQuery().before(cursor)
  }

  key = () => {
    return `collection:${this.id}`
  }

  private createQuery () {
    return new Query<T>(this.id, this.client, this.onQuerySnapshotRegister)
  }

  private onQuerySnapshotRegister = (q: Query<T>, fn: SubscriptionFn<CollectionList<T>>, errFn?: SubscriptionErrorFn) => {
    const k = q.key()
    if (!this.querySubs[k]) {
      this.querySubs[k] = new Subscription<CollectionList<T>>(q.request(), this.client)
    }
    return this.querySubs[k].subscribe(fn, errFn)
  }

  private onDocSnapshotRegister = (d: Doc<T>, fn: SubscriptionFn<CollectionDocument<T>>, errFn?: SubscriptionErrorFn) => {
    const k = d.key()
    if (!this.docSubs[k]) {
      this.docSubs[k] = new Subscription<CollectionDocument<T>>(d.request(), this.client)
    }
    return this.docSubs[k].subscribe(fn, errFn)
  }
}
