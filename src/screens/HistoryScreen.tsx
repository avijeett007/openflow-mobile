import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { computeAnalytics } from '@openflow/shared';
import { Body, Button, Card, Screen, Title } from '../components/ui';
import { useAppState } from '../context/AppState';
import type { AppHistoryRecord } from '../lib/historyStore';
import { colors, font, spacing } from '../theme';
import { strings } from '../strings';

function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

function Stat({ value, label }: { value: string; label: string }): React.ReactElement {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function HistoryRow({ record }: { record: AppHistoryRecord }): React.ReactElement {
  const date = new Date(record.ts);
  const text = record.cleanedText ?? record.rawText;
  return (
    <Card>
      <View style={styles.rowHeader}>
        <Text style={styles.rowDate}>{date.toLocaleString()}</Text>
        <Text style={styles.rowMeta}>
          {record.wordCount} words · {record.sttProvider}
        </Text>
      </View>
      {text ? <Body>{text}</Body> : <Body dim>{strings.history.redacted}</Body>}
      {record.cleanupFailed ? <Text style={styles.flag}>{strings.history.rawOnly}</Text> : null}
    </Card>
  );
}

export function HistoryScreen(): React.ReactElement {
  const { history, clearAllHistory } = useAppState();
  const analytics = useMemo(() => computeAnalytics(history), [history]);

  return (
    <Screen>
      <Title>{strings.history.title}</Title>

      <Card>
        <View style={styles.statsRow}>
          <Stat value={`${analytics.totalWords}`} label={strings.history.analyticsWords} />
          <Stat value={`${analytics.dictationCount}`} label={strings.history.analyticsCount} />
          <Stat
            value={formatDuration(analytics.estimatedSecondsSaved)}
            label={strings.history.analyticsSaved}
          />
        </View>
      </Card>

      {history.length === 0 ? (
        <Body dim>{strings.history.empty}</Body>
      ) : (
        <>
          {history.map((r) => (
            <HistoryRow key={r.id} record={r} />
          ))}
          <View style={{ height: spacing.md }} />
          <Button label={strings.history.clearAll} onPress={clearAllHistory} variant="danger" />
        </>
      )}
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  statsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center', gap: spacing.xs },
  statValue: { color: colors.violet, fontSize: font.title, fontWeight: '800' },
  statLabel: {
    color: colors.textDim,
    fontSize: font.tiny,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowDate: { color: colors.textDim, fontSize: font.small },
  rowMeta: { color: colors.textFaint, fontSize: font.tiny },
  flag: { color: colors.warning, fontSize: font.tiny },
});
