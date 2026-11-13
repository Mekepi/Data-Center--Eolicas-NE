import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { PipelineSsotProvider } from './data/pipelineSsotContext.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <PipelineSsotProvider>
    <App />
  </PipelineSsotProvider>,
);
