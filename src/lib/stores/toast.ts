import { writable } from 'svelte/store';

export const toastMessage = writable<string>('');

let timer: ReturnType<typeof setTimeout>;

export function toast(msg: string, duration = 1800) {
  clearTimeout(timer);
  toastMessage.set(msg);
  timer = setTimeout(() => toastMessage.set(''), duration);
}
