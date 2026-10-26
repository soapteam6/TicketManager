import { useState } from 'react';
import { ReviewApp } from './ReviewApp';
import { demoProvider, getDemoNow, setDemoNow } from './demo';
export function SyntheticReview() {
  const [now, setNow] = useState(getDemoNow);
  return (
    <ReviewApp
      provider={demoProvider}
      now={now}
      onClock={(next) => {
        setDemoNow(next);
        setNow(next);
        demoProvider.refresh();
      }}
    />
  );
}
