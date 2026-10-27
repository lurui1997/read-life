export type ReadLifeSettings = {
  apiKey: string
  wrName: string | null
  noteFolder: string
  lastSyncAt: string | null
  lastSyncMessage: string
}

export const DEFAULT_SETTINGS: ReadLifeSettings = {
  apiKey: '',
  wrName: null,
  noteFolder: '折角',
  lastSyncAt: null,
  lastSyncMessage: '',
}
