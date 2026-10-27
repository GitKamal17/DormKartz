import './style.css';
import { App } from './app';

const root = document.getElementById('app')!;
const app = new App(root);
app.start();

// Read-only hook for automated smoke tests.
(window as unknown as { dormkartz: { status: () => Record<string, unknown> } }).dormkartz = { status: () => app.status() };
