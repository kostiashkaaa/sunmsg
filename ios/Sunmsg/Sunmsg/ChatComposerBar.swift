import PhotosUI
import SwiftUI

struct ComposerReplyPreview: Equatable {
    let senderName: String
    let text: String
}

struct ChatComposerBar: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @Binding var sendError: String?
    @Binding var decryptionSummary: String?
    @Binding var composerText: String
    @Binding var selectedPhotoItem: PhotosPickerItem?
    let composerFocused: FocusState<Bool>.Binding
    let isComposerFocused: Bool

    let editingMessageId: Int?
    let replyPreview: ComposerReplyPreview?
    let isSending: Bool
    let isUploadingMedia: Bool
    let isRecording: Bool
    let recordingDuration: TimeInterval
    let placeholder: String
    let canSendSecureMessage: Bool
    let emojiSuggestions: [String]
    let formatRecordingTime: (TimeInterval) -> String
    let onCancelEdit: () -> Void
    let onCancelReply: () -> Void
    let onSend: () -> Void
    let onStartVoiceRecording: () -> Void
    let onCancelRecording: () -> Void
    let onStopAndSendRecording: () -> Void

    @State private var recordingPulse = false

    private typealias Metrics = ChatDesignMetrics.Composer

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
            } else if let replyPreview {
                replyBanner(replyPreview)
            }

            HStack(alignment: .bottom, spacing: Metrics.rowSpacing) {
                if isRecording {
                    recordingCapsule
                    recordingSendButton
                } else {
                    attachmentButton
                    inputCapsule
                    actionButton
                }
            }
            .padding(.horizontal, Metrics.horizontalPadding)
            .padding(.top, Metrics.topPadding)
            .padding(.bottom, Metrics.bottomPadding)
        }
        .background(.regularMaterial)
        .background(Color.smBg.opacity(0.94).ignoresSafeArea(edges: .bottom))
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
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.smAccent2)
                Text(composerText)
                    .font(.caption)
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

    private func replyBanner(_ preview: ComposerReplyPreview) -> some View {
        HStack(spacing: 10) {
            Rectangle()
                .fill(Color.smAccent)
                .frame(width: 3, height: 30)
                .clipShape(Capsule())

            VStack(alignment: .leading, spacing: 1) {
                Text(preview.senderName)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.smAccent2)
                    .lineLimit(1)
                Text(preview.text)
                    .font(.caption)
                    .foregroundStyle(Color.smMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            Button(action: onCancelReply) {
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
                Image(systemName: "paperclip")
                    .font(.system(size: Metrics.iconSize, weight: .regular))
                    .foregroundStyle(canSendSecureMessage ? Color.smAccent : Color.smFaint)
                    .frame(width: Metrics.sideButtonSize, height: Metrics.sideButtonSize)
                    .contentShape(Circle())
            }
            .buttonStyle(PressableStyle(scale: 0.92))
            .disabled(!canSendSecureMessage || isSending || isUploadingMedia)
            .accessibilityLabel("Вложение")
        } else {
            Color.clear
                .frame(width: Metrics.sideButtonSize, height: Metrics.sideButtonSize)
                .accessibilityHidden(true)
        }
    }

    private var inputCapsule: some View {
        HStack(alignment: .center, spacing: 8) {
            ZStack(alignment: .leading) {
                if composerText.isEmpty && !isUploadingMedia {
                    Text(placeholder)
                        .font(.body)
                        .foregroundStyle(Color.smFaint)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                        .truncationMode(.tail)
                        .allowsHitTesting(false)
                }

                if isUploadingMedia {
                    uploadContent
                } else {
                    TextField("", text: $composerText, axis: .vertical)
                        .focused(composerFocused)
                        .font(.body)
                        .foregroundStyle(Color.smText)
                        .tint(Color.smAccent)
                        .lineLimit(1...5)
                        .submitLabel(.send)
                        .onSubmit {
                            guard canSendSecureMessage, !isSending, !isUploadingMedia, !trimmedText.isEmpty else { return }
                            onSend()
                        }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, Metrics.inputVerticalPadding)

            trailingInputButton
        }
        .padding(.leading, Metrics.inputLeadingPadding)
        .padding(.trailing, Metrics.inputTrailingPadding)
        .frame(minHeight: Metrics.inputMinHeight)
        .background(Color.smSurface.opacity(0.96), in: RoundedRectangle(cornerRadius: Metrics.inputRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Metrics.inputRadius, style: .continuous)
                .stroke(isComposerFocused ? Color.smAccent.opacity(0.58) : Color.smBorderSoft, lineWidth: 0.8)
        )
    }

    private var recordingCapsule: some View {
        HStack(spacing: 12) {
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
                    .font(.body.monospacedDigit().weight(.semibold))
                    .foregroundStyle(Color.smText)
                    .fixedSize(horizontal: true, vertical: false)
            }

            Spacer(minLength: 8)

            Button(action: onCancelRecording) {
                Text("Отмена")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Color.smAccent)
                    .frame(minWidth: 76)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Отменить запись")

            Spacer(minLength: 8)
        }
        .padding(.horizontal, Metrics.inputLeadingPadding)
        .frame(maxWidth: .infinity)
        .frame(minHeight: Metrics.inputMinHeight)
        .background(Color.smSurface.opacity(0.96), in: RoundedRectangle(cornerRadius: Metrics.inputRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Metrics.inputRadius, style: .continuous)
                .stroke(Color.smBorderSoft, lineWidth: 0.8)
        )
    }

    private var recordingSendButton: some View {
        Button(action: onStopAndSendRecording) {
            Image(systemName: "arrow.up")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Color.smBubbleOutText)
                .frame(width: Metrics.sideButtonSize, height: Metrics.sideButtonSize)
                .background(Color.smAccent, in: Circle())
                .shadow(color: Color.smAccent.opacity(0.26), radius: 5, x: 0, y: 2)
        }
        .buttonStyle(PressableStyle(scale: 0.9))
        .accessibilityLabel("Отправить голосовое сообщение")
    }

    private var uploadContent: some View {
        HStack(spacing: 8) {
            ProgressView()
                .tint(Color.smAccent)
                .scaleEffect(0.75)
            Text("Загрузка…")
                .font(.callout)
                .foregroundStyle(Color.smFaint)
        }
    }

    @ViewBuilder
    private var trailingInputButton: some View {
        if isUploadingMedia {
            Color.clear
                .frame(width: Metrics.innerButtonSize, height: Metrics.innerButtonSize)
                .accessibilityHidden(true)
        } else {
            Menu {
                ForEach(emojiSuggestions, id: \.self) { emoji in
                    Button(emoji) { composerText.append(emoji) }
                }
            } label: {
                Image(systemName: "face.smiling")
                    .font(.system(size: 21))
                    .foregroundStyle(Color.smMuted)
                    .frame(width: Metrics.innerButtonSize, height: Metrics.innerButtonSize)
                    .contentShape(Circle())
            }
            .accessibilityLabel("Эмодзи")
        }
    }

    private var actionButton: some View {
        Group {
            if isSending || isUploadingMedia {
                ProgressView()
                    .tint(Color.smBubbleOutText)
                    .frame(width: Metrics.sideButtonSize, height: Metrics.sideButtonSize)
                    .background(Color.smAccent, in: Circle())
            } else if editingMessageId != nil {
                composerActionButton(
                    systemName: "checkmark",
                    fill: canSendSecureMessage && !trimmedText.isEmpty ? Color.smAccent : Color.smFaint,
                    disabled: !canSendSecureMessage || trimmedText.isEmpty,
                    action: onSend
                )
            } else if trimmedText.isEmpty && !isUploadingMedia && !isRecording {
                composerActionButton(
                    systemName: "mic.fill",
                    fill: canSendSecureMessage ? Color.smText : Color.smFaint,
                    disabled: !canSendSecureMessage,
                    action: onStartVoiceRecording
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
                .font(.system(size: systemName == "mic.fill" ? 22 : 18, weight: .semibold))
                .foregroundStyle(systemName == "mic.fill" ? fill : Color.smBubbleOutText)
                .frame(width: Metrics.sideButtonSize, height: Metrics.sideButtonSize)
                .background {
                    if systemName != "mic.fill" {
                        Circle()
                            .fill(fill)
                            .frame(width: Metrics.sendButtonSize, height: Metrics.sendButtonSize)
                    }
                }
                .overlay {
                    if systemName != "mic.fill" {
                        Circle()
                            .stroke(Color.smAccent.opacity(0.18), lineWidth: 0.5)
                            .frame(width: Metrics.sendButtonSize, height: Metrics.sendButtonSize)
                    }
                }
                .contentShape(Circle())
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
                .font(.caption)
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
