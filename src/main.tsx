import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import {LanguageProvider} from './LanguageControl';
import './styles.css';
import './controls.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><LanguageProvider><App /></LanguageProvider></React.StrictMode>);
