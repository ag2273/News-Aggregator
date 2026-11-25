// The "listen to this article" control in the reader header (#56).
//
// The user's screenshot marks the spot: immediately to the left of the
// open-in-browser icon, at the end of the header row. One tap starts reading the
// headline then the body; a second tap stops. The icon IS the state, so there is no
// separate playbar to explain.

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Theme } from '../constants/colors';
import type { ArticleSpeech } from '../lib/articleSpeech';
import { openVoiceInstallSettings } from '../lib/articleSpeech';
import { Linking } from 'react-native';

export function ListenButton({
  speech,
  t,
}: {
  speech: ArticleSpeech;
  t: Theme;
}) {
  const { phase, toggle } = speech;
  const busy = phase === 'starting';
  const speaking = phase === 'speaking';

  return (
    <TouchableOpacity
      onPress={toggle}
      style={styles.button}
      accessibilityRole="button"
      // The label the screen reader announces, and the one the tests assert on.
      accessibilityLabel={speaking ? 'إيقاف الاستماع' : 'استماع للخبر'}
      accessibilityState={{ busy, selected: speaking }}
      testID="listen-button"
    >
      {busy ? (
        <ActivityIndicator size="small" color={t.accent} />
      ) : (
        <Ionicons
          name={speaking ? 'stop-circle-outline' : 'volume-high-outline'}
          size={21}
          color={speaking ? t.accent : t.textSecondary}
        />
      )}
    </TouchableOpacity>
  );
}

/**
 * The one-line notice under the header.
 *
 * Only two things are said: there is no text to read, or there is no Arabic voice on
 * this device. Both are facts about the phone, and the second offers the one action
 * that fixes it. Nothing here blocks the article: it is already on screen.
 */
export function SpeechNotice({ speech, t }: { speech: ArticleSpeech; t: Theme }) {
  if (!speech.notice) return null;
  const missingVoice = speech.phase === 'unsupported';
  return (
    <View style={[styles.notice, { backgroundColor: t.badgePlate }]}>
      <Text style={[styles.noticeText, { color: t.textSecondary }]}>{speech.notice}</Text>
      {missingVoice ? (
        <TouchableOpacity
          onPress={() => void openVoiceInstallSettings(Linking)}
          accessibilityRole="button"
          accessibilityLabel="تنزيل الصوت"
          testID="install-voice-button"
        >
          <Text style={[styles.noticeAction, { color: t.accent }]}>تنزيل الصوت</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  noticeText: { flex: 1, fontFamily: 'Cairo_400Regular', fontSize: 11, lineHeight: 18 },
  noticeAction: { fontFamily: 'Cairo_600SemiBold', fontSize: 11 },
});
