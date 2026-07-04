import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Body, Card, Screen, Title } from '../components/ui';
import { Wordmark } from '../components/Wordmark';
import { colors, font, spacing } from '../theme';
import { strings } from '../strings';

function LinkRow({ label, url }: { label: string; url: string }): React.ReactElement {
  return (
    <Text
      accessibilityRole="link"
      style={styles.link}
      onPress={() => {
        void Linking.openURL(url);
      }}
    >
      {label}
    </Text>
  );
}

export function AboutScreen(): React.ReactElement {
  const version = Constants.expoConfig?.version ?? '0.1.0';
  return (
    <Screen>
      <Title>{strings.about.title}</Title>
      <View style={styles.brand}>
        <Wordmark size={30} />
        <Body dim style={{ marginTop: spacing.sm }}>
          {strings.about.tagline}
        </Body>
      </View>

      <Card>
        <Body>{strings.about.license}</Body>
        <LinkRow label={strings.about.website} url="https://openflow.computer" />
        <LinkRow
          label={strings.about.github}
          url="https://github.com/avijeett007/openflow-mobile"
        />
        <LinkRow label={strings.about.coffee} url="https://buymeacoffee.com/kno2gether" />
        <LinkRow label={strings.about.email} url="mailto:hello@openflow.computer" />
      </Card>

      <Card>
        <Text style={styles.meta}>
          {strings.about.version} {version}
        </Text>
        <Text style={styles.meta}>{strings.about.credit}</Text>
      </Card>
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', paddingVertical: spacing.md },
  link: {
    color: colors.violet,
    fontSize: font.body,
    fontWeight: '600',
    paddingVertical: spacing.xs,
  },
  meta: { color: colors.textDim, fontSize: font.small },
});
