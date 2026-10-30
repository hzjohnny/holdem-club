import { useColyseus } from './useColyseus';
import { Home } from './components/Home';
import { Waiting } from './components/Waiting';
import { Table } from './components/Table';

export default function App() {
  const { phase, table, error, quickStart, sendAction } = useColyseus();

  if (phase === 'home') return <Home onStart={quickStart} />;
  if (phase === 'waiting') return <Waiting />;
  if (phase === 'error') return <Home onStart={quickStart} error={error} />;
  if (!table) return <Waiting />;
  return <Table state={table} onAction={sendAction} />;
}
