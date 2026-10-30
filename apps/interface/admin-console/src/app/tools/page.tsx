import { RequireCapability } from '@/components/session/require-capability';
import { ToolsTable } from '@/components/tools-table';

export const metadata = { title: 'Connexions MCP · Console d’administration' };

export default function Page() {
  return (
    <RequireCapability capability="tools.view">
      <ToolsTable />
    </RequireCapability>
  );
}
