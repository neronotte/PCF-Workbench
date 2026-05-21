import {
  makeStyles, tokens, RadioGroup, Radio, Label, SpinButton, Divider,
} from '@fluentui/react-components';
import { useHarnessStore, type NetworkMode } from '../../store/harness-store';

const useStyles = makeStyles({
  root: {
    padding: '12px',
  },
  header: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    marginBottom: '8px',
  },
  desc: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    marginBottom: '4px',
  },
  customInput: {
    marginTop: '8px',
  },
});

const NETWORK_DESCRIPTIONS: Record<string, string> = {
  online: 'No throttling — instant responses',
  offline: 'context.webAPI serves from local data store (data.json). webAPI.online calls reject. client.isOffline() = true',
  slow3g: '2000ms latency on all WebAPI calls',
  fast3g: '500ms latency on all WebAPI calls',
  custom: 'Custom latency in milliseconds',
};

export function NetworkPanel() {
  const styles = useStyles();
  const networkMode = useHarnessStore(s => s.networkMode);
  const customLatencyMs = useHarnessStore(s => s.customLatencyMs);
  const setNetworkMode = useHarnessStore(s => s.setNetworkMode);
  const setCustomLatencyMs = useHarnessStore(s => s.setCustomLatencyMs);

  return (
    <div className={styles.root}>
      <div
        className={styles.header}
        title="Network Conditioning — simulate poor connectivity. Adds a per-call latency to context.webAPI requests, or forces offline mode so context.client.isOffline() returns true and webAPI.online calls reject. Tests how the control behaves on slow / disconnected networks."
      >
        Network Conditioning
      </div>
      <RadioGroup
        value={networkMode}
        onChange={(_, data) => setNetworkMode(data.value as NetworkMode)}
      >
        <Radio value="online" label="Online (unrestricted)" title="Online — no throttling. WebAPI calls resolve as fast as the in-memory store can serve them. context.client.isOffline() = false." />
        <Radio value="offline" label="Offline (disconnected)" title="Offline — context.client.isOffline() = true. context.webAPI serves from the local data store (data.json). webAPI.online calls reject as if the user lost connectivity." />
        <Radio value="slow3g" label="Slow 3G (2000ms)" title="Slow 3G — adds 2000ms latency to every context.webAPI call. Tests loading states and timeout handling on poor connections." />
        <Radio value="fast3g" label="Fast 3G (500ms)" title="Fast 3G — adds 500ms latency to every context.webAPI call. Tests perceptible-but-not-broken slow-network behaviour." />
        <Radio value="custom" label="Custom" title="Custom — pick your own latency in milliseconds. Useful for reproducing specific perceived-perf issues a user reported." />
      </RadioGroup>
      <div className={styles.desc}>{NETWORK_DESCRIPTIONS[networkMode]}</div>

      {networkMode === 'custom' && (
        <div className={styles.customInput}>
          <Label size="small">Latency (ms)</Label>
          <SpinButton
            size="small"
            value={customLatencyMs}
            min={0}
            max={30000}
            step={100}
            onChange={(_, data) => setCustomLatencyMs(data.value ?? 1000)}
          />
        </div>
      )}

      <Divider style={{ margin: '12px 0' }} />

      <div
        className={styles.header}
        title="WebAPI Routing — the harness mirrors how real Dynamics 365 routes WebAPI calls between online (server) and offline (local cache) stores. Use these three surfaces to test offline-aware controls."
      >
        WebAPI Routing
      </div>
      <div style={{ fontSize: 11, color: tokens.colorNeutralForeground3, lineHeight: '18px' }}>
        <div style={{ marginBottom: 6 }}>Mirrors Dynamics 365 behavior:</div>
        <table style={{ fontSize: 11, borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            <tr>
              <td style={{ padding: '3px 6px', fontFamily: 'Consolas, monospace', fontWeight: 600 }}>context.webAPI</td>
              <td style={{ padding: '3px 6px' }}>Auto-routes — works online and offline (from data.json)</td>
            </tr>
            <tr style={{ backgroundColor: tokens.colorNeutralBackground3 }}>
              <td style={{ padding: '3px 6px', fontFamily: 'Consolas, monospace', fontWeight: 600 }}>webAPI.online</td>
              <td style={{ padding: '3px 6px' }}>Server only — rejects when offline</td>
            </tr>
            <tr>
              <td style={{ padding: '3px 6px', fontFamily: 'Consolas, monospace', fontWeight: 600 }}>webAPI.offline</td>
              <td style={{ padding: '3px 6px' }}>Local store only — always instant, no latency</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
