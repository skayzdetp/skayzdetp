import { CompassIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/EmptyState'

export function NotFoundPage() {
  return (
    <EmptyState icon={CompassIcon} title="Page not found" description="The page you are looking for does not exist.">
      <Link to="/" className="text-sm underline">
        Go to your servers
      </Link>
    </EmptyState>
  )
}
