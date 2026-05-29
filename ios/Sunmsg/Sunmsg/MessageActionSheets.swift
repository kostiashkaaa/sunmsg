import SwiftUI

struct ForwardMessageSheet: View {
    let contacts: [Contact]
    let currentChatId: String
    let onCancel: () -> Void
    let onSelect: (Contact) -> Void

    private var targets: [Contact] {
        contacts
            .filter { !$0.chatId.isEmpty }
            .sorted {
                if $0.isPinned != $1.isPinned { return $0.isPinned && !$1.isPinned }
                return $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending
            }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(targets) { contact in
                    Button {
                        onSelect(contact)
                    } label: {
                        HStack(spacing: 12) {
                            SmAvatarView(
                                name: contact.displayName,
                                avatarUrl: contact.avatarUrl,
                                isGroup: contact.isGroup,
                                size: 36
                            )

                            VStack(alignment: .leading, spacing: 2) {
                                Text(contact.displayName)
                                    .font(.system(size: 16, weight: .medium))
                                    .foregroundStyle(Color.smText)
                                    .lineLimit(1)
                                Text(contact.chatId == currentChatId ? "текущий чат" : (contact.isGroup ? "группа" : "@\(contact.username)"))
                                    .font(.system(size: 12))
                                    .foregroundStyle(Color.smFaint)
                                    .lineLimit(1)
                            }

                            Spacer(minLength: 8)

                            Image(systemName: "arrowshape.turn.up.forward")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(Color.smMuted)
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.smBg)
            .navigationTitle("Переслать")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена", action: onCancel)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

struct MessageInfoSheet: View {
    let message: ChatMessage
    let isFromMe: Bool
    let displayText: String

    private var createdDate: Date {
        Date(timeIntervalSince1970: message.createdAt)
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Сообщение") {
                    infoRow("ID", value: "\(message.id)", icon: "number")
                    infoRow("Тип", value: message.messageType, icon: "bubble.left")
                    infoRow("Создано", value: SunDateFormatters.ruDayMonth(from: createdDate) + " " + SunDateFormatters.time(from: createdDate), icon: "clock")
                    infoRow("Изменено", value: message.isEdited ? "Да" : "Нет", icon: "clock.arrow.circlepath")
                }

                if isFromMe {
                    Section("Статусы") {
                        infoRow("Доставка", value: message.isDelivered ? "Доставлено" : "Отправляется", icon: "checkmark.circle")
                        infoRow("Прочтение", value: message.isRead ? "Прочитано" : "Не прочитано", icon: "checkmark.circle.fill")
                    }
                }

                Section("Текст") {
                    Text(displayText.isEmpty ? "Пустое сообщение" : displayText)
                        .font(.system(size: 15))
                        .foregroundStyle(Color.smText)
                        .textSelection(.enabled)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.smBg)
            .navigationTitle("Информация")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func infoRow(_ title: String, value: String, icon: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.smMuted)
                .frame(width: 22)
            Text(title)
                .foregroundStyle(Color.smMuted)
            Spacer(minLength: 12)
            Text(value)
                .foregroundStyle(Color.smText)
                .multilineTextAlignment(.trailing)
        }
        .font(.system(size: 14))
    }
}
