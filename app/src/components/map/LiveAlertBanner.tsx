import { alertMeta } from '@/components/alerts/AlertCard';
import { Banner } from '@/components/ui/Banner';
import type { Alert } from '@/types/database';

type Props = {
  alert: Alert;
  onNavigate?: () => void;
  onDismiss?: () => void;
  compact?: boolean;
};

/** A newly arrived alert, shown first in the BannerStack on every screen. */
export function LiveAlertBanner({ alert, onNavigate, onDismiss, compact }: Props) {
  const m = alertMeta(alert.alert_type);
  return (
    <Banner
      tone={m.tone}
      icon={m.icon}
      compact={compact}
      title={alert.title}
      message={alert.description}
      actionLabel={alert.livestock_id ? 'View animal' : 'View alerts'}
      onAction={onNavigate}
      onDismiss={onDismiss}
    />
  );
}
