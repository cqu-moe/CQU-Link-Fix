import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { PopupApp } from './App';

const root = document.querySelector('#root');
if (!(root instanceof HTMLElement)) throw new Error('Missing popup root');
createRoot(root).render(createElement(PopupApp));
