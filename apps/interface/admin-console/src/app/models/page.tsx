import { RequireCapability } from '@/components/session/require-capability';
import { ModelsOverview } from '@/components/models/models-overview';

export const metadata = { title: 'Modèle IA · Console d’administration' };

export default function Page() {
  return (
    <RequireCapability capability="models.view">
      <ModelsOverview />
    </RequireCapability>
  );
}
