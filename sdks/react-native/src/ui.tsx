import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { FeedbackError } from './index.js';
import type { Analytics, FeedbackReceipt } from './index.js';

export interface FeedbackSheetProps {
  analytics: Pick<Analytics, 'feedback'>;
  visible: boolean;
  onClose: () => void;
  onSent?: (receipt: FeedbackReceipt) => void;
  title?: string;
  accentColor?: string;
}

/** Optional UI entry point; importing the core SDK does not load React or native UI. */
export function FeedbackSheet({
  analytics,
  visible,
  onClose,
  onSent,
  title = 'Contact us',
  accentColor = '#17618e',
}: FeedbackSheetProps) {
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const submissionId = useRef<string | undefined>(undefined);
  const edit = (value: string, field: 'message' | 'email') => {
    if (pending.current) return;
    submissionId.current = undefined;
    setError('');
    if (field === 'message') setMessage(value);
    else setEmail(value);
  };
  const close = () => {
    if (pending.current) return;
    if (sent) {
      setSent(false);
      setMessage('');
      setEmail('');
      submissionId.current = undefined;
    }
    onClose();
  };
  const send = async () => {
    if (pending.current || !message.trim()) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const receipt = await analytics.feedback({
        message,
        email,
        submissionId: submissionId.current,
      });
      setSent(true);
      // A host callback must not turn a confirmed delivery into a failed submission.
      try {
        onSent?.(receipt);
      } catch {
        /* The message has already been stored. */
      }
    } catch (failure) {
      // Separate SDK entry points can contain separate class instances.
      const known =
        failure instanceof Error &&
        failure.name === 'FeedbackError' &&
        'submissionId' in failure &&
        typeof failure.submissionId === 'string';
      if (known) submissionId.current = (failure as FeedbackError).submissionId;
      setError(known ? failure.message : 'Could not send. Please try again.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              {sent ? 'Message sent' : title}
            </Text>
            <Pressable
              onPress={close}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Close contact form"
              style={styles.close}
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            {sent ? (
              <>
                <Text
                  accessibilityRole="text"
                  accessibilityLiveRegion="polite"
                  testID="feedback-success"
                  style={styles.body}
                >
                  Thanks for getting in touch.
                  {email.trim() ? ' We can reply to the email you provided.' : ''}
                </Text>
                <Pressable
                  onPress={close}
                  accessibilityRole="button"
                  style={[styles.send, { backgroundColor: accentColor }]}
                >
                  <Text style={styles.sendText}>Done</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.label}>Message</Text>
                <TextInput
                  accessibilityLabel="Your message"
                  testID="feedback-message"
                  placeholder="How can we help?"
                  placeholderTextColor="#7b818a"
                  multiline
                  maxLength={4000}
                  value={message}
                  editable={!busy}
                  onChangeText={(value) => edit(value, 'message')}
                  style={[styles.input, styles.message]}
                  textAlignVertical="top"
                />
                <View style={styles.emailLabel}>
                  <Text style={styles.label}>Email</Text>
                  <Text style={styles.optional}>Optional, if you’d like a reply</Text>
                </View>
                <TextInput
                  accessibilityLabel="Your email (optional)"
                  testID="feedback-email"
                  placeholder="you@example.com"
                  placeholderTextColor="#7b818a"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={254}
                  value={email}
                  editable={!busy}
                  onChangeText={(value) => edit(value, 'email')}
                  style={styles.input}
                />
                {!!error && (
                  <Text accessibilityRole="alert" testID="feedback-error" style={styles.error}>
                    {error}
                  </Text>
                )}
                <Pressable
                  onPress={() => void send()}
                  disabled={busy || !message.trim()}
                  testID="feedback-send"
                  accessibilityRole="button"
                  accessibilityLabel={busy ? 'Sending message' : 'Send message'}
                  accessibilityState={{ disabled: busy || !message.trim(), busy }}
                  style={[
                    styles.send,
                    { backgroundColor: accentColor },
                    (busy || !message.trim()) && styles.disabled,
                  ]}
                >
                  {busy && <ActivityIndicator color="white" />}
                  <Text style={styles.sendText}>{busy ? 'Sending…' : 'Send message'}</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000055' },
  sheet: {
    maxHeight: '90%',
    backgroundColor: 'white',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d7dbe0',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  title: { fontSize: 24, fontWeight: '600', color: '#202432' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 28, color: '#67707d' },
  content: { padding: 24, paddingTop: 16, paddingBottom: 40, gap: 12 },
  label: { fontSize: 14, fontWeight: '600', color: '#202432' },
  input: {
    borderWidth: 1,
    borderColor: '#d9dee5',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#202432',
    backgroundColor: '#fafbfc',
  },
  message: { minHeight: 140, maxHeight: 220 },
  emailLabel: { gap: 4, marginTop: 8 },
  optional: { fontSize: 12, color: '#67707d' },
  body: { fontSize: 16, lineHeight: 24, color: '#505867', marginBottom: 12 },
  error: { color: '#b42318', fontSize: 14, lineHeight: 20 },
  send: {
    minHeight: 50,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    marginTop: 8,
  },
  sendText: { color: 'white', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
