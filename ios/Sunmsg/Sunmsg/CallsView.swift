import SwiftUI

// MARK: - Calls list view

struct CallsView: View {
    @EnvironmentObject var session: SessionStore
    @State private var selectedSegment = 0

    private var filteredCalls: [CallRecord] {
        selectedSegment == 0 ? session.callHistory : session.callHistory.filter { $0.missed }
    }

    private var missedCount: Int { session.callHistory.filter { $0.missed }.count }

    var body: some View {
        let calls = filteredCalls

        ZStack {
            Color.smBg.ignoresSafeArea()

            VStack(spacing: 0) {
                headerRow
                segmentedControl

                if calls.isEmpty {
                    emptyState
                } else {
                    List {
                        ForEach(calls) { call in
                            CallRowView(call: call)
                                .listRowInsets(EdgeInsets())
                                .listRowSeparator(.visible, edges: .bottom)
                                .listRowSeparatorTint(Color.smBorderSoft)
                                .listRowBackground(Color.smSurface)
                                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                    Button(role: .destructive) {
                                        deleteCall(call)
                                    } label: { Label("Удалить", systemImage: "trash") }
                                }
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .background(Color.smSurface)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
                    .shadow(color: Color(hex: "#281e0f").opacity(0.05), radius: 4, x: 0, y: 2)
                    .padding(.horizontal, 12)
                    .padding(.top, 12)
                    .padding(.bottom, 20)
                }
            }
        }
        .navigationBarHidden(true)
    }

    private func deleteCall(_ call: CallRecord) {
        if let idx = session.callHistory.firstIndex(where: { $0.id == call.id }) {
            session.callHistory.remove(at: idx)
            session.saveCallHistory()
        }
    }

    // MARK: - Header

    private var headerRow: some View {
        HStack {
            Text("Звонки")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Color.smText)
                .tracking(-0.6)

            Spacer()

            if !session.callHistory.isEmpty {
                Button(action: {
                    session.callHistory.removeAll()
                    session.saveCallHistory()
                }) {
                    Text("Очистить")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.smAccent)
                }
                .buttonStyle(.plain)
                .padding(.trailing, 10)
            }

            Button(action: { session.selectedTab = 2 }) {
                Image(systemName: "plus")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(Color.smAccent2)
                    .frame(width: 36, height: 36)
                    .background(Color.smAccent.opacity(0.10), in: Circle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 6)
    }

    // MARK: - Segmented control (matches prototype exactly)

    private var segmentedControl: some View {
        HStack(spacing: 0) {
            segmentButton("Все", index: 0)
            segmentButton("Пропущенные", index: 1, badge: missedCount)
        }
        .padding(3)
        .background(Color.smBorder.opacity(0.30), in: RoundedRectangle(cornerRadius: 10))
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
    }

    private func segmentButton(_ label: String, index: Int, badge: Int? = nil) -> some View {
        Button(action: { withAnimation(.easeInOut(duration: 0.18)) { selectedSegment = index } }) {
            HStack(spacing: 6) {
                Text(label)
                    .font(.system(size: 13, weight: selectedSegment == index ? .semibold : .medium))
                    .foregroundStyle(selectedSegment == index ? Color.smText : Color.smMuted)
                if let badge, badge > 0 {
                    Text("\(badge)")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(Color.smAccent, in: Capsule())
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(
                selectedSegment == index ? Color.smSurface : Color.clear,
                in: RoundedRectangle(cornerRadius: 8)
            )
            .shadow(
                color: selectedSegment == index ? Color(hex: "#281e0f").opacity(0.08) : .clear,
                radius: 2, y: 1
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "phone.slash")
                .font(.system(size: 44))
                .foregroundStyle(Color.smFaint)
            Text("Нет звонков")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Color.smMuted)
            Text("Список ваших вызовов пуст")
                .font(.system(size: 14))
                .foregroundStyle(Color.smFaint)
            Spacer()
        }
    }
}

// MARK: - Call row

struct CallRowView: View {
    let call: CallRecord
    @EnvironmentObject var session: SessionStore

    var body: some View {
        HStack(spacing: 12) {
            ZStack(alignment: .bottomTrailing) {
                SmAvatarView(name: call.name, size: 44)
                if call.isOnline {
                    Circle().fill(Color.smOnline)
                        .frame(width: 11, height: 11)
                        .overlay(Circle().stroke(Color.smSurface, lineWidth: 2))
                        .offset(x: 1, y: 1)
                }
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(call.name)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(call.missed ? Color(hex: "#c14242") : Color.smText)
                    .lineLimit(1)
                    .tracking(-0.2)

                HStack(spacing: 5) {
                    callArrow
                    Text(callSubtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(call.missed ? Color(hex: "#c14242").opacity(0.75) : Color.smMuted)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 6) {
                // Call-back button — amber circle
                Button(action: {
                    let chatId: String? = call.chatId
                        ?? session.contacts.first(where: { $0.displayName == call.name })?.chatId
                    if let cid = chatId {
                        session.initiateCall(
                            chatId: cid,
                            callType: call.callType == .video ? "video" : "audio"
                        )
                    } else {
                        session.selectedTab = 2
                    }
                }) {
                    Image(systemName: call.callType == .video ? "video.fill" : "phone.fill")
                        .font(.system(size: call.callType == .video ? 15 : 14, weight: .medium))
                        .foregroundStyle(Color.smAccent2)
                        .frame(width: 36, height: 36)
                        .background(Color.smAccent.opacity(0.10), in: Circle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Color.smSurface)
        .contentShape(Rectangle())
    }

    private var callSubtitle: String {
        let dir = call.missed ? "Пропущенный" : (call.direction == .outgoing ? "Исходящий" : "Входящий")
        let dur = call.duration != nil ? ", \(call.duration!)" : ""
        return "\(dir) · \(call.when)\(dur)"
    }

    private var callArrow: some View {
        let isOut = call.direction == .outgoing
        let color: Color = call.missed ? Color(hex: "#c14242") : (isOut ? Color.smOnline : Color.smFaint)
        return Image(systemName: isOut ? "arrow.up.right" : "arrow.down.left")
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(color)
    }
}
