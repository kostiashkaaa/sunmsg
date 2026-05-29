import SwiftUI

// MARK: - Login flow steps

private enum LoginFlow: Equatable {
    case landing
    case restore          // username + mnemonic form
    case loading
    case totp(csrfToken: String, privateKeyPEM: String)
    case error(String)
}

private enum LoginContentScreen: Hashable {
    case landing
    case restore
    case totp

    init?(_ flow: LoginFlow) {
        switch flow {
        case .landing:
            self = .landing
        case .restore, .error:
            self = .restore
        case .totp:
            self = .totp
        case .loading:
            return nil
        }
    }
}

// MARK: - Native login view

struct NativeLoginView: View {
    @EnvironmentObject var session: SessionStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var flow: LoginFlow = .landing
    @State private var lastContentScreen: LoginContentScreen = .landing
    @State private var username = ""
    @State private var mnemonic = ""
    @State private var totpCode = ""
    @State private var totpError: String?
    @FocusState private var focusedField: Field?

    private enum Field { case username, mnemonic, totp }

    private var contentScreen: LoginContentScreen {
        LoginContentScreen(flow) ?? lastContentScreen
    }

    private var isLoading: Bool {
        flow == .loading
    }

    private var contentTransition: AnyTransition {
        reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .trailing))
    }

    var body: some View {
        ZStack {
            Color.smBg.ignoresSafeArea()
            RadialGradient(
                colors: [Color.smAccent.opacity(0.08), Color.clear],
                center: .center, startRadius: 0, endRadius: 320
            )
            .ignoresSafeArea()

            Group {
                switch contentScreen {
                case .landing:
                    landingView
                case .restore:
                    restoreFormView
                case .totp:
                    totpView
                }
            }
            .id(contentScreen)
            .transition(contentTransition)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.22), value: contentScreen)

            if isLoading {
                loadingOverlay
                    .transition(.opacity)
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.18), value: isLoading)
        .onChange(of: flow) { _, newFlow in
            if let screen = LoginContentScreen(newFlow) {
                lastContentScreen = screen
            }
        }
    }

    // MARK: - Landing (3 options)

    private var landingView: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                // Brand section — matches prototype (orb 56, "sun" 28pt, serif italic subtitle)
                VStack(spacing: 0) {
                    AmberOrb(size: 56)
                    Text("sun")
                        .font(.title.weight(.bold))
                        .foregroundStyle(Color.smText)
                        .padding(.top, 14)
                    Text("добро пожаловать в мессенджер")
                        .font(.custom("Georgia", size: 15, relativeTo: .subheadline).italic())
                        .foregroundStyle(Color.smMuted)
                        .padding(.top, 4)
                }
                .padding(.top, 56)
                .padding(.bottom, 22)

                // Auth card
                VStack(spacing: 0) {
                    // Header
                    VStack(spacing: 4) {
                        Text("ВХОД В АККАУНТ")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(Color.smMuted)
                            .tracking(0.6)
                        Text("аккаунт — это ваша 24-словная фраза. она хранится только на устройстве.")
                            .font(.caption)
                            .foregroundStyle(Color.smMuted)
                            .multilineTextAlignment(.center)
                            .lineSpacing(2)
                    }
                    .padding(.bottom, 20)

                    QRLoginPanel { scannedUsername, privateKeyPEM in
                        await MainActor.run { flow = .loading }
                        do {
                            try await completeLoginWithPrivateKey(username: scannedUsername, privateKeyPEM: privateKeyPEM)
                        } catch {
                            await MainActor.run { flow = .landing }
                            throw error
                        }
                    }
                    .padding(.bottom, 16)

                    // Primary: create new account (4-point sparkle, dark fill, matches prototype)
                    Button(action: openRegister) {
                        HStack(spacing: 8) {
                            SparkleStar(size: 14)
                                .foregroundStyle(Color(hex: "#fbf8f1"))
                            Text("Создать новый аккаунт")
                                .font(.subheadline.weight(.semibold))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .foregroundStyle(Color(hex: "#fbf8f1"))
                        .background(Color.smText, in: RoundedRectangle(cornerRadius: 12))
                        .shadow(color: Color.smText.opacity(0.30), radius: 8, x: 0, y: 4)
                    }
                    .buttonStyle(.plain)

                    // Divider
                    HStack(spacing: 10) {
                        Rectangle().fill(Color.smBorder).frame(height: 1)
                        Text("или")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Color.smFaint)
                            .tracking(0.6)
                            .textCase(.uppercase)
                        Rectangle().fill(Color.smBorder).frame(height: 1)
                    }
                    .padding(.vertical, 16)

                    // Restore by phrase
                    Button(action: { flow = .restore }) {
                        HStack(spacing: 10) {
                            ZStack {
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(Color.smAccent.opacity(0.10))
                                    .frame(width: 30, height: 30)
                                Image(systemName: "arrow.counterclockwise")
                                    .font(.system(size: 13))
                                    .foregroundStyle(Color.smAccent2)
                            }
                            VStack(alignment: .leading, spacing: 1) {
                                Text("Восстановить по фразе")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(Color.smText)
                                Text("введите 24 слова")
                                    .font(.caption2)
                                    .foregroundStyle(Color.smMuted)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Color.smFaint)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .background(Color.smBg, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color.smBorder, lineWidth: 0.5)
                        )
                    }
                    .buttonStyle(.plain)

                    // Footer note
                    Text("продолжая, вы принимаете\nусловия использования и политику")
                        .font(.caption2)
                        .foregroundStyle(Color.smFaint)
                        .multilineTextAlignment(.center)
                        .padding(.top, 18)
                }
                .padding(18)
                .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 18))
                .overlay(
                    RoundedRectangle(cornerRadius: 18)
                        .stroke(Color.smBorder, lineWidth: 0.5)
                )
                .shadow(color: Color.black.opacity(0.08), radius: 12, x: 0, y: 4)
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: - Restore form (username + mnemonic)

    private var restoreFormView: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                // Back + logo
                HStack {
                    Button(action: {
                        focusedField = nil
                        flow = .landing
                        username = ""
                        mnemonic = ""
                    }) {
                        HStack(spacing: 4) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 14, weight: .semibold))
                            Text("Назад")
                                .font(.callout)
                        }
                        .foregroundStyle(Color.smAccent)
                    }
                    .buttonStyle(.plain)
                    Spacer()
                }
                .padding(.top, 60)
                .padding(.horizontal, 28)

                VStack(spacing: 16) {
                    AmberOrb(size: 60)
                    Text("Восстановить аккаунт")
                        .font(.title2.weight(.bold))
                        .foregroundStyle(Color.smText)
                    Text("введите имя пользователя и 24 слова")
                        .font(.subheadline.italic())
                        .foregroundStyle(Color.smMuted)
                }
                .padding(.top, 24)
                .padding(.bottom, 32)

                VStack(spacing: 20) {
                    // Username
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Имя пользователя", systemImage: "person")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.smMuted)
                            .textCase(.uppercase)
                            .tracking(0.5)

                        TextField("@username", text: $username)
                            .focused($focusedField, equals: .username)
                            .textContentType(.username)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .submitLabel(.next)
                            .onSubmit { focusedField = .mnemonic }
                            .font(.body)
                            .foregroundStyle(Color.smText)
                            .tint(Color.smAccent)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)
                            .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(focusedField == .username ? Color.smAccent : Color.smBorder, lineWidth: 0.75)
                            )
                    }

                    // Mnemonic
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Секретная фраза (24 слова)", systemImage: "key")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.smMuted)
                            .textCase(.uppercase)
                            .tracking(0.5)

                        ZStack(alignment: .topLeading) {
                            if mnemonic.isEmpty {
                                Text("слово1 слово2 слово3 … слово24")
                                    .font(.system(.subheadline, design: .monospaced))
                                    .foregroundStyle(Color.smFaint)
                                    .padding(.horizontal, 16)
                                    .padding(.top, 14)
                                    .allowsHitTesting(false)
                            }
                            TextEditor(text: $mnemonic)
                                .focused($focusedField, equals: .mnemonic)
                                .font(.system(.subheadline, design: .monospaced))
                                .foregroundStyle(Color.smText)
                                .tint(Color.smAccent)
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.never)
                                .scrollContentBackground(.hidden)
                                .frame(minHeight: 110, maxHeight: 160)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                        }
                        .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(focusedField == .mnemonic ? Color.smAccent : Color.smBorder, lineWidth: 0.75)
                        )

                        HStack(spacing: 5) {
                            Image(systemName: "doc.on.doc")
                                .font(.system(size: 11))
                                .foregroundStyle(Color.smAccent2)
                            Text("Вставить из буфера")
                                .font(.caption)
                                .foregroundStyle(Color.smAccent2)
                        }
                        .onTapGesture {
                            if let str = UIPasteboard.general.string { mnemonic = str }
                        }
                    }

                    if case .error(let msg) = flow {
                        HStack(spacing: 6) {
                            Image(systemName: "exclamationmark.circle.fill")
                            Text(msg)
                                .font(.subheadline)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .foregroundStyle(Color.smDanger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, -6)
                        .onTapGesture { flow = .restore }
                    }

                    // Sign in button
                    Button(action: handleSignIn) {
                        HStack(spacing: 8) {
                            Image(systemName: "arrow.right.circle.fill")
                                .font(.system(size: 17))
                            Text("Войти")
                                .font(.headline)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .foregroundStyle(Color(hex: "#fbf8f1"))
                        .background(Color.smAccent, in: RoundedRectangle(cornerRadius: 14))
                        .shadow(color: Color.smAccent.opacity(0.35), radius: 8, x: 0, y: 4)
                    }
                    .buttonStyle(.plain)
                    .disabled(username.trimmingCharacters(in: .whitespaces).isEmpty || mnemonic.trimmingCharacters(in: .whitespaces).isEmpty)
                    .opacity(username.isEmpty || mnemonic.isEmpty ? 0.55 : 1)

                    encryptionBadge
                }
                .padding(.horizontal, 28)
                .padding(.bottom, 40)
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: - TOTP form

    private var totpView: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 20) {
                VStack(spacing: 8) {
                    Image(systemName: "shield.lefthalf.filled")
                        .font(.system(size: 36))
                        .foregroundStyle(Color.smAccent)
                    Text("Двухфакторная аутентификация")
                        .font(.headline)
                        .foregroundStyle(Color.smText)
                    Text("Введите 6-значный код из приложения-аутентификатора.")
                        .font(.subheadline)
                        .foregroundStyle(Color.smMuted)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 80)
                .padding(.bottom, 8)

                TextField("000000", text: $totpCode)
                    .focused($focusedField, equals: .totp)
                    .textContentType(.oneTimeCode)
                    .keyboardType(.numberPad)
                    .font(.system(.title, design: .monospaced).weight(.light))
                    .foregroundStyle(Color.smText)
                    .tint(Color.smAccent)
                    .multilineTextAlignment(.center)
                    .padding(.vertical, 14)
                    .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(Color.smBorder, lineWidth: 0.75)
                    )
                    .padding(.horizontal, 28)
                    .onChange(of: totpCode) { _, val in
                        let filtered = val.filter { $0.isNumber }.prefix(6)
                        if String(filtered) != val { totpCode = String(filtered) }
                        if filtered.count == 6 { handleTOTP() }
                    }

                if let errMsg = totpError {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.circle.fill")
                        Text(errMsg).font(.subheadline)
                    }
                    .foregroundStyle(Color.smDanger)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 28)
                }

                Button(action: handleTOTP) {
                    Text("Подтвердить")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .foregroundStyle(Color(hex: "#fbf8f1"))
                        .background(Color.smAccent, in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)
                .disabled(totpCode.count != 6)
                .opacity(totpCode.count == 6 ? 1 : 0.55)
                .padding(.horizontal, 28)

                Button(action: {
                    focusedField = nil
                    flow = .landing
                    totpCode = ""
                }) {
                    Text("Использовать другой аккаунт")
                        .font(.subheadline)
                        .foregroundStyle(Color.smMuted)
                        .underline()
                }
                .buttonStyle(.plain)
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .onAppear { focusedField = .totp }
    }

    // MARK: - Encryption badge

    private var encryptionBadge: some View {
        HStack(spacing: 5) {
            Image(systemName: "lock.fill").font(.system(size: 10))
            Text("Сквозное шифрование · фраза никогда не покидает устройство")
                .font(.caption2)
        }
        .foregroundStyle(Color.smFaint)
        .multilineTextAlignment(.center)
        .padding(.top, 4)
    }

    // MARK: - Loading overlay

    private var loadingOverlay: some View {
        ZStack {
            Color.black.opacity(0.35).ignoresSafeArea()
            VStack(spacing: 12) {
                ProgressView().tint(Color.smAccent).scaleEffect(1.2)
                Text("Вход в аккаунт…")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Color.smMuted)
            }
            .padding(28)
            .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.smBorder, lineWidth: 0.5))
        }
    }

    // MARK: - Actions

    private func openRegister() {
        focusedField = nil
        guard !reduceMotion else {
            session.route = .register
            return
        }
        withAnimation(.easeInOut(duration: 0.22)) {
            session.route = .register
        }
    }

    private func handleSignIn() {
        focusedField = nil
        let trimmedUser = username.trimmingCharacters(in: .whitespaces).lowercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: "@"))
        let trimmedMnemonic = mnemonic.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedUser.isEmpty, !trimmedMnemonic.isEmpty else { return }
        flow = .loading

        Task {
            do {
                let api = APIClient.shared
                api.resetAuthSession()
                let csrfTok = try await api.getCsrfToken()
                api.csrfToken = csrfTok
                let challengeResp = try await api.getChallenge(username: trimmedUser)
                let (privateKeyPEM, signature): (String, String) = try await Task.detached(priority: .userInitiated) {
                    let pem = try SunCrypto.decryptVault(challengeResp.loginVault, mnemonic: trimmedMnemonic)
                    let sig = try SunCrypto.rsaSign(challengeResp.challenge, privateKeyPEM: pem)
                    return (pem, sig)
                }.value
                let loginResp = try await api.loginChallenge(signature: signature)
                if loginResp.requiresTotp {
                    flow = .totp(csrfToken: loginResp.csrfToken ?? csrfTok, privateKeyPEM: privateKeyPEM)
                } else {
                    try? KeychainService.savePrivateKey(privateKeyPEM)
                    await session.loadBootstrap()
                    if session.route != .main {
                        flow = .error(session.errorMessage ?? "Не удалось загрузить сессию. Попробуйте ещё раз.")
                        session.errorMessage = nil
                    }
                }
            } catch SunCryptoError.noDecryptionKey {
                await MainActor.run { flow = .error("Неверная фраза — не удалось расшифровать хранилище.") }
            } catch SunCryptoError.pbkdf2Failed {
                await MainActor.run { flow = .error("Ошибка вывода ключа. Проверьте фразу.") }
            } catch let apiErr as APIError {
                await MainActor.run { flow = .error(apiErr.localizedDescription) }
            } catch {
                await MainActor.run { flow = .error(error.localizedDescription) }
            }
        }
    }

    private func completeLoginWithPrivateKey(username rawUsername: String, privateKeyPEM: String) async throws {
        let trimmedUser = rawUsername.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: "@"))
        guard !trimmedUser.isEmpty else {
            throw NSError(
                domain: "SUNmessenger.NativeLogin",
                code: 0,
                userInfo: [NSLocalizedDescriptionKey: "Не удалось определить аккаунт для QR-входа."]
            )
        }

        let api = APIClient.shared
        if api.csrfToken.isEmpty {
            api.csrfToken = try await api.getCsrfToken()
        }
        let csrfTok = api.csrfToken
        let challengeResp = try await api.getChallenge(username: trimmedUser)
        let signature = try await Task.detached(priority: .userInitiated) {
            try SunCrypto.rsaSign(challengeResp.challenge, privateKeyPEM: privateKeyPEM)
        }.value
        let loginResp = try await api.loginChallenge(signature: signature)
        if loginResp.requiresTotp {
            await MainActor.run {
                flow = .totp(csrfToken: loginResp.csrfToken ?? csrfTok, privateKeyPEM: privateKeyPEM)
            }
            return
        }

        try? KeychainService.savePrivateKey(privateKeyPEM)
        await session.loadBootstrap()
        if session.route != .main {
            let message = session.errorMessage ?? "Не удалось загрузить сессию. Попробуйте ещё раз."
            session.errorMessage = nil
            throw NSError(
                domain: "SUNmessenger.NativeLogin",
                code: 0,
                userInfo: [NSLocalizedDescriptionKey: message]
            )
        }
    }

    private func handleTOTP() {
        guard case .totp(let csrfTok, let privateKeyPEM) = flow else { return }
        guard totpCode.count == 6 else { return }
        focusedField = nil
        flow = .loading

        Task {
            do {
                APIClient.shared.csrfToken = csrfTok
                _ = try await APIClient.shared.loginTOTP(code: totpCode)
                try? KeychainService.savePrivateKey(privateKeyPEM)
                await session.loadBootstrap()
                if session.route != .main {
                    flow = .totp(csrfToken: csrfTok, privateKeyPEM: privateKeyPEM)
                    totpError = session.errorMessage ?? "Не удалось загрузить сессию."
                    session.errorMessage = nil
                }
            } catch let apiErr as APIError {
                await MainActor.run {
                    totpCode = ""
                    totpError = apiErr.localizedDescription
                    flow = .totp(csrfToken: csrfTok, privateKeyPEM: privateKeyPEM)
                }
            } catch {
                await MainActor.run {
                    totpCode = ""
                    totpError = error.localizedDescription
                    flow = .totp(csrfToken: csrfTok, privateKeyPEM: privateKeyPEM)
                }
            }
        }
    }
}

// MARK: - 4-point sparkle star shape (matches prototype SVG path)

struct SparkleStar: View {
    let size: CGFloat

    var body: some View {
        StarShape()
            .frame(width: size, height: size)
    }
}

private struct StarShape: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let w = rect.width, h = rect.height
        // 4-point star: top, right, bottom, left + inner pinch points (matches prototype path)
        // path d="M8 1.5l1.6 4.4 4.4 1.6-4.4 1.6L8 13.5 6.4 9.1 2 7.5l4.4-1.6L8 1.5z"
        // Normalize 16x16 -> w,h
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x / 16 * w, y: rect.minY + y / 16 * h)
        }
        p.move(to: pt(8, 1.5))
        p.addLine(to: pt(9.6, 5.9))
        p.addLine(to: pt(14, 7.5))
        p.addLine(to: pt(9.6, 9.1))
        p.addLine(to: pt(8, 13.5))
        p.addLine(to: pt(6.4, 9.1))
        p.addLine(to: pt(2, 7.5))
        p.addLine(to: pt(6.4, 5.9))
        p.closeSubpath()
        return p
    }
}
