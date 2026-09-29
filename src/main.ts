import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import vuetify from './plugins/vuetify'
import { useAuthStore } from './stores/auth'
import './assets/main.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)

// Rebuild the axios client from any stored credentials *before* the router's first
// navigation guard runs, so a page refresh while logged in doesn't bounce to /login.
const auth = useAuthStore()
if (auth.isAuthenticated) {
  await auth.rehydrateClient()
}

app.use(router)
app.use(vuetify)
app.mount('#app')
