import { ReviewApp } from './ReviewApp';
import { demoProvider } from './demo';

export function SyntheticReview() {
  return <ReviewApp provider={demoProvider} />;
}
