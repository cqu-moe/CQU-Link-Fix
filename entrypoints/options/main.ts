import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { OptionsApp } from './App';

const root = document.querySelector('#root');
if (!(root instanceof HTMLElement)) throw new Error('Missing options root');
createRoot(root).render(createElement(OptionsApp));
