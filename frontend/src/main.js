import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import './style.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');

if ('serviceWorker' in navigator) {
  const mode = import.meta.env.DEV ? '?dev=1' : '';
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`/sw.js${mode}`).catch(() => {});
  });
}