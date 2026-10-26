import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { SyntheticReview } from './SyntheticReview';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SyntheticReview />
  </StrictMode>,
);
