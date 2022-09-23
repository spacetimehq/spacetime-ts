import { Collection } from './Collection'
import { SubscriptionErrorFn, SubscriptionFn } from './Subscription'
import { Client } from './Client'
import { Request, CollectionDocument } from './types'

export type DocSnapshotRegister<T> = (d: Doc<T>, fn: SubscriptionFn<CollectionDocument<T>>, errFn?: SubscriptionErrorFn) => (() => void)

export class Doc<T> {
  id: string
  private collection: Collection<T>
  private client: Client
  private onSnapshotRegister: DocSnapshotRegister<T>

  constructor (id: string, collection: Collection<T>, client: Client, onSnapshotRegister: DocSnapshotRegister<T>) {
    this.id = id
    this.collection = collection
    this.client = client
    this.onSnapshotRegister = onSnapshotRegister
  }

  delete = async (): Promise<CollectionDocument<T>> => {
    const res = await this.client.request({
      ...this.request(),
      method: 'DELETE',
    }).send()
    return res.data
  }

  set = async (data: Partial<T>, publicKeys?: string[]): Promise<CollectionDocument<T>> => {
    data = {
      id: this.id,
      ...data,
      ...(publicKeys ? { $pk: publicKeys.join(',') } : {}),
    }

    // TODO: check validatoon results
    const isValid = await this.collection.validate(data)
    if (!isValid) {
      throw new Error('doc is not valid')
    }

    const res = await this.client.request({
      url: `/data/${encodeURIComponent(this.collection.id)}/${encodeURIComponent(this.id)}`,
      method: 'PUT',
      data: {
        data,
      },
    }).send()

    return res.data
  }

  get = async (): Promise<CollectionDocument<T>> => {
    const res = await this.client.request(this.request()).send()
    return res.data
  }

  key = () => {
    return `doc:${this.collection.id}/${this.id}`
  }

  onSnapshot = (fn: SubscriptionFn<CollectionDocument<T>>, errFn?: SubscriptionErrorFn) => {
    return this.onSnapshotRegister(this, fn, errFn)
  }

  request = (): Request => ({
    url: `/data/${encodeURIComponent(this.collection.id)}/${encodeURIComponent(this.id)}`,
    method: 'GET',
  })
}
