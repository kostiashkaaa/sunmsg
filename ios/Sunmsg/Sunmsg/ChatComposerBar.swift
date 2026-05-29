import PhotosUI
import SwiftUI

struct ChatComposerBar: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @Binding var sendError: String?
    @Binding var decryptionSummary: String?
    @Binding var composerText: String
    @Binding var selectedPhotoItem: PhotosPickerItem?
    let composerFocused: FocusState<Bool>.Binding
    let isComposerFocused: Bool

    let editingMessageId: Int?
    let isSending: Bool
    let isUploadingMedia: Bool
    let isRecording: Bool
    let recordingDuration: TimeInterval
    let placeholder: String
    let canSendSecureMessage: Bool
    let emojiSuggestions: [String]
    let formatRecordingTime: (TimeInterval) -> String
    let onCancelEdit: () -> Void
    let onSend: () -> Void
    let onStartVoiceRecording: () -> Void
    let onCancelRecording: () -> Void
    let onStopAndSendRecording: () -> Void

    @State private var recordingPulse = false

    private var trimmedText: String {
        composerText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        VStack(spacing: 0) {
            if sendError != nil || decryptionSummary != nil {
                composerNotices
            }

            if editingMessageId != nil {
                editingBanner
            }

            HStack(alignment: .bottom, spacing: 7) {
                attachmentButton
                inputCapsule
                actionButton
            }
            .padding(.horizontal, 8)
            .padding(.top, 7)
            .padding(.bottom, 8)
        }
        .background(Color.smBg.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Color.smBorderSoft)
                .frame(height: 0.5)
        }
        .opacity(isRecording ? 1 : (canSendSecureMessage ? 1 : 0.68))
    }

    private var composerNotices: some View {
        VStack(spacing: 4) {
            if let sendError {
                ComposerNoticeView(
                    iconName: "exclamationmark.circle.fill",
                    text: sendError,
                    tint: Color.smDanger,
                    onDismiss: { self.sendError = nil }
                )
            }

            if let decryptionSummary {
                ComposerNoticeView(
                    iconName: "lock.trianglebadge.exclamationmark",
                    text: decryptionSummary,
                    tint: Color.smMuted,
                    onDismiss: { self.decryptionSummary = nil }
                )
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 7)
    }

    private var editingBanner: some View {
        HStack(spacing: 10) {
            Rectangle()
                .fill(Color.smAccent)
                .frame(width: 3, height: 30)
                .clipShape(Capsule())

            VStack(alignment: .leading, spacing: 1) {
                Text("Изменение сообщения")
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(Color.smAccent2)
                Text(composerText)
                    .font(.system(size: 12.5))
                    .foregroundStyle(Color.smMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            Button(action: onCancelEdit) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.smMuted)
                    .frame(width: 28, height: 28)
                    .background(Color.smText.opacity(0.06), in: Circle())
            }
            .buttonStyle(PressableStyle(scale: 0.94))
        }
        .padding(.horizontal, 12)
        .padding(.top, 7)
    }

    @ViewBuilder
    private var attachmentButton: some View {
        if !isRecording && editingMessageId == nil {
            PhotosPicker(selection: $selectedPhotoItem, matching: .images) {
                Image(systemName: "plus")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(canSendSecureMessage ? Color.smAccent : Color.smFaint)
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(PressableStyle(scale: 0.92))
            .disabled(!canSendSecureMessage || isSending || isUploadingMedia)
            .accessibilityLabel("Вложение")
        }
    }

    private var inputCapsule: some View {
        HStack(alignment: .bottom, spacing: 4) {
            ZStack(alignment: .leading) {
                if isRecording {
                    recordingContent
                } else if composerText.isEmpty && !isUploadingMedia {
                    Text(placeholder)
                        .font(.system(size: 15))
                        .foregroundStyle(Color.smFaint)
                        .allowsHitTesting(false)
                }

                if isUploadingMedia {
                    uploadContent
                } else if !isRecording {
                    TextField("", text: $composerText, axis: .vertical)
                        .focused(composerFocused)
                        .font(.system(size: 15))
                        .foregroundStyle(Color.smText)
                        .tint(Color.smAccent)
                        .lineLimit(1...5)
                        .submitLabel(.send)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 6)

            trailingInputButton
        }
        .padding(.leading, 12)
        .padding(.trailing, 4)
        .frame(minHeight: 38)
        .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 19, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 19, style: .continuous)
                .stroke(isComposerFocused ? Color.smAccent.opacity(0.48) : Color.smBorder, lineWidth: 0.6)
        )
    }

    private var recordingContent: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(Color.red)
                .frame(width: 8, height: 8)
                .opacity(reduceMotion ? 1.0 : (recordingPulse ? 1.0 : 0.35))
                .animation(
                    reduceMotion ? nil : .easeInOut(duration: 0.55).repeatForever(autoreverses: true),
                    value: recordingPulse
                )
                .onAppear { recordingPulse = true }
                .onDisappear { recordingPulse = false }

            Text(formatRecordingTime(recordingDuration))
                .font(.system(size: 14, weight: .medium, design: .monospaced))
                .foregroundStyle(Color.smText)

            Text("Голосовое сообщение")
                .font(.system(size: 14))
                .foregroundStyle(Color.smFaint)
                .lineLimit(1)
        }
    }

    private var uploadContent: some View {
        HStack(spacing: 8) {
            ProgressView()
                .tint(Color.smAccent)
                .scaleEffect(0.75)
            Text("Загрузка…")
                .font(.system(size: 14))
                .foregroundStyle(Color.smFaint)
        }
    }

    @ViewBuilder
    private var trailingInputButton: some View {
        if isRecording {
            Button(action: onCancelRecording) {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.smMuted)
                    .frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Отменить запись")
        } else if isUploadingMedia {
            EmptyView()
        } else {
            Menu {
                ForEach(emojiSuggestions, id: \.self) { emoji in
                    Button(emoji) { composerText.append(emoji) }
                }
            } label: {
                Image(systemName: "face.smiling")
                    .font(.system(size: 18))
                    .foregroundStyle(Color.smMuted)
                    .frame(width: 32, height: 32)
            }
            .accessibilityLabel("Эмодзи")
        }
    }

    private var actionButton: some View {
        Group {
            if isSending || isUploadingMedia {
                ProgressView()
                    .tint(Color.smBubbleOutText)
                    .frame(width: 36, height: 36)
                    .background(Color.smAccent, in: Circle())
            } else if editingMessageId != nil {
                composerActionButton(
                    systemName: "checkmark",
                    fill: trimmedText.isEmpty ? Color.smFaint : Color.smAccent,
                    disabled: trimmedText.isEmpty,
                    action: onSend
                )
            } else if trimmedText.isEmpty && !isUploadingMedia && !isRecording {
                composerActionButton(
                    systemName: "mic.fill",
                    fill: canSendSecureMessage ? Color.smText : Color.smFaint,
                    disabled: !canSendSecureMessage,
                    action: onStartVoiceRecording
                )
            } else if isRecording {
                composerActionButton(
                    systemName: "arrow.up",
                    fill: Color.red,
                    disabled: false,
                    action: onStopAndSendRecording
                )
            } else {
                composerActionButton(
                    systemName: "arrow.up",
                    fill: canSendSecureMessage ? Color.smAccent : Color.smFaint,
                    disabled: !canSendSecureMessage || trimmedText.isEmpty,
                    action: onSend
                )
            }
        }
    }

    private func composerActionButton(
        systemName: String,
        fill: Color,
        disabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.smBubbleOutText)
                .frame(width: 36, height: 36)
                .background(fill, in: Circle())
        }
        .buttonStyle(PressableStyle(scale: 0.92))
        .disabled(disabled)
    }
}

private struct ComposerNoticeView: View {
    let iconName: String
    let text: String
    let tint: Color
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: iconName)
                .font(.system(size: 12.5, weight: .semibold))
            Text(text)
                .font(.system(size: 12.5))
                .lineLimit(2)
            Spacer(minLength: 8)
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .semibold))
                    .frame(width: 24, height: 24)
            }
            .buttonStyle(.plain)
        }
        .foregroundStyle(tint)
    }
}
