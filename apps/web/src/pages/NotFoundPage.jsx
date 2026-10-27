import { Link } from 'react-router-dom';
import { FileQuestion } from 'lucide-react';
import { TopBar } from '../components/layout/TopBar.jsx';
import { PageBody } from '../components/layout/PageBody.jsx';
import { EmptyState } from '../components/ui/index.jsx';

export function NotFoundPage() {
  return (
    <>
      <TopBar title="Page not found" />
      <PageBody>
        <div className="panel">
          <EmptyState
            icon={FileQuestion}
            title="That page does not exist"
            hint="The link may be out of date."
            action={
              <Link to="/" className="link mt-1 text-sm">
                Back to the overview
              </Link>
            }
          />
        </div>
      </PageBody>
    </>
  );
}
