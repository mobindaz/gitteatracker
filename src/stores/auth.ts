import { defineStore } from 'pinia'
import type { AxiosInstance } from 'axios'
import type { GiteaUser } from '../types/gitea'
import { buildClient, fetchProfile, describeConnectionError, type GiteaCredentials } from '../api/gitea'

const SESSION_KEY = 'gitea-tracker-auth-session'
const LOCAL_KEY = 'gitea-tracker-auth-local'

export const DEFAULT_BASE_URL = 'http://192.168.1.10:3000'

interface StoredCreds extends GiteaCredentials {}

function loadStored(): StoredCreds | null {
  try {
    const fromSession = sessionStorage.getItem(SESSION_KEY)
    if (fromSession) return JSON.parse(fromSession)
    const fromLocal = localStorage.getItem(LOCAL_KEY)
    if (fromLocal) return JSON.parse(fromLocal)
  } catch {
    // ignore corrupt storage
  }
  return null
}

export const useAuthStore = defineStore('auth', {
  state: () => {
    const stored = loadStored()
    return {
      baseUrl: stored?.baseUrl || DEFAULT_BASE_URL,
      username: stored?.username || '',
      secret: stored?.secret || '',
      authMode: (stored?.authMode || 'token') as 'token' | 'basic',
      profile: null as GiteaUser | null,
      isAuthenticated: !!stored,
      authError: '',
      isAuthenticating: false,
      client: null as AxiosInstance | null
    }
  },

  actions: {
    async login(creds: GiteaCredentials, remember: boolean) {
      this.authError = ''
      this.isAuthenticating = true
      try {
        const client = buildClient(creds)
        const profile = await fetchProfile(client)
        this.client = client
        this.profile = profile
        this.baseUrl = creds.baseUrl
        this.username = creds.username
        this.secret = creds.secret
        this.authMode = creds.authMode
        this.isAuthenticated = true

        const payload = JSON.stringify(creds)
        if (remember) {
          localStorage.setItem(LOCAL_KEY, payload)
          sessionStorage.removeItem(SESSION_KEY)
        } else {
          sessionStorage.setItem(SESSION_KEY, payload)
          localStorage.removeItem(LOCAL_KEY)
        }
        return true
      } catch (e) {
        this.authError = describeConnectionError(e, creds.baseUrl)
        return false
      } finally {
        this.isAuthenticating = false
      }
    },

    // Rebuilds the axios client from stored credentials on a fresh page load, without
    // re-prompting the user. Call this once at app startup if isAuthenticated is true.
    async rehydrateClient(): Promise<boolean> {
      if (!this.isAuthenticated || !this.username || !this.secret) return false
      try {
        const client = buildClient({
          baseUrl: this.baseUrl,
          username: this.username,
          secret: this.secret,
          authMode: this.authMode
        })
        const profile = await fetchProfile(client)
        this.client = client
        this.profile = profile
        return true
      } catch (e) {
        this.authError = describeConnectionError(e, this.baseUrl)
        this.logout()
        return false
      }
    },

    logout() {
      this.isAuthenticated = false
      this.profile = null
      this.client = null
      this.secret = ''
      sessionStorage.removeItem(SESSION_KEY)
      localStorage.removeItem(LOCAL_KEY)
    }
  }
})
