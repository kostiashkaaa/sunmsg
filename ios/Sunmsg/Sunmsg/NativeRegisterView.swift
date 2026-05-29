import SwiftUI

// MARK: - Register state machine

private enum RegisterStep: Equatable {
    case form
    case loading
    case error(String)
}

// MARK: - Native registration view

struct NativeRegisterView: View {
    @EnvironmentObject var session: SessionStore

    @State private var username = ""
    @State private var displayName = ""
    @State private var mnemonic = ""
    @State private var mnemonicCopied = false
    @State private var copyResetTask: Task<Void, Never>?
    @State private var savedConfirmed = false
    @State private var step: RegisterStep = .form
    @FocusState private var focusedField: Field?

    private enum Field { case username, displayName }

    var body: some View {
        ZStack {
            Color.smBg.ignoresSafeArea()
            RadialGradient(
                colors: [Color.smAccent.opacity(0.07), Color.clear],
                center: .center, startRadius: 0, endRadius: 320
            )
            .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    logoSection
                        .padding(.top, 60)
                        .padding(.bottom, 32)

                    formSection
                }
                .padding(.horizontal, 28)
                .padding(.bottom, 40)
            }
            .scrollDismissesKeyboard(.interactively)

            if step == .loading {
                loadingOverlay
            }
        }
        .navigationBarHidden(true)
        .onAppear { generateInitialMnemonicIfNeeded() }
        .onDisappear {
            copyResetTask?.cancel()
            copyResetTask = nil
        }
    }

    // MARK: - Logo

    private var logoSection: some View {
        VStack(spacing: 16) {
            AmberOrb(size: 72)
            VStack(spacing: 4) {
                Text("Создать аккаунт")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Color.smText)
                    .tracking(-0.8)
                Text("настройте зашифрованную идентичность")
                    .font(.system(size: 14).italic())
                    .foregroundStyle(Color.smMuted)
            }
        }
    }

    // MARK: - Form

    private var formSection: some View {
        VStack(spacing: 20) {
            // Username
            fieldBlock(label: "Имя пользователя", icon: "person") {
                TextField("@username", text: $username)
                    .focused($focusedField, equals: .username)
                    .textContentType(.username)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .submitLabel(.next)
                    .onSubmit { focusedField = .displayName }
                    .font(.system(size: 16))
                    .foregroundStyle(Color.smText)
                    .tint(Color.smAccent)
            }

            // Display name
            fieldBlock(label: "Отображаемое имя", icon: "signature") {
                TextField("Ваше имя", text: $displayName)
                    .focused($focusedField, equals: .displayName)
                    .textContentType(.name)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .onSubmit { focusedField = nil }
                    .font(.system(size: 16))
                    .foregroundStyle(Color.smText)
                    .tint(Color.smAccent)
            }

            // Mnemonic phrase
            mnemonicBlock

            // Save confirmation
            saveToggle

            if case .error(let msg) = step {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.circle.fill")
                    Text(msg)
                        .font(.system(size: 13.5))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(Color(hex: "#c0392b"))
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            // Create button
            Button(action: handleRegister) {
                HStack(spacing: 8) {
                    Image(systemName: "person.badge.plus")
                        .font(.system(size: 16))
                    Text("Создать аккаунт")
                        .font(.system(size: 16, weight: .semibold))
                        .tracking(-0.2)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .foregroundStyle(Color(hex: "#fbf8f1"))
                .background(isFormValid ? Color.smAccent : Color.smBorder, in: RoundedRectangle(cornerRadius: 14))
                .shadow(color: isFormValid ? Color.smAccent.opacity(0.35) : .clear, radius: 8, x: 0, y: 4)
            }
            .buttonStyle(.plain)
            .disabled(!isFormValid)
            .animation(.easeInOut(duration: 0.15), value: isFormValid)

            // Back to login
            Button(action: {
                focusedField = nil
                withAnimation(.easeInOut(duration: 0.22)) {
                    session.route = .login
                }
            }) {
                Text("Уже есть аккаунт? Войти")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.smMuted)
                    .underline()
            }
            .buttonStyle(.plain)
            .padding(.top, 4)

            encryptionBadge
        }
    }

    // MARK: - Field wrapper

    private func fieldBlock<C: View>(label: String, icon: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(label, systemImage: icon)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.smMuted)
                .textCase(.uppercase)
                .tracking(0.5)
            content()
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.smBorder, lineWidth: 0.75))
        }
    }

    // MARK: - Mnemonic block

    private var mnemonicBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Секретная фраза (24 слова)", systemImage: "key.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.smMuted)
                    .textCase(.uppercase)
                    .tracking(0.5)
                Spacer()
                Button(action: generateMnemonic) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.smAccent)
                }
                .buttonStyle(.plain)
                .help("Generate new phrase")
            }

            // Word grid
            mnemonicGrid

            // Copy button
            Button(action: copyMnemonic) {
                HStack(spacing: 6) {
                    Image(systemName: mnemonicCopied ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 13))
                    Text(mnemonicCopied ? "Скопировано!" : "Скопировать фразу")
                        .font(.system(size: 13, weight: .medium))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 9)
                .foregroundStyle(mnemonicCopied ? Color.smOnline : Color.smAccent)
                .background(
                    mnemonicCopied ? Color.smOnline.opacity(0.12) : Color.smAccent.opacity(0.10),
                    in: RoundedRectangle(cornerRadius: 10)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(mnemonicCopied ? Color.smOnline.opacity(0.4) : Color.smAccent.opacity(0.3), lineWidth: 0.5)
                )
            }
            .buttonStyle(.plain)
            .animation(.easeInOut(duration: 0.2), value: mnemonicCopied)

            Text("Эта фраза — единственный способ восстановить аккаунт. Сохраните её в надёжном месте — она никогда не отправляется на сервер.")
                .font(.system(size: 12))
                .foregroundStyle(Color.smFaint)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var mnemonicGrid: some View {
        let words = mnemonic.components(separatedBy: " ").filter { !$0.isEmpty }
        let columns = [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())]
        return LazyVGrid(columns: columns, spacing: 6) {
            ForEach(Array(words.enumerated()), id: \.offset) { idx, word in
                HStack(spacing: 4) {
                    Text("\(idx + 1)")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(Color.smFaint)
                        .frame(minWidth: 16, alignment: .trailing)
                    Text(word)
                        .font(.system(size: 12.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(Color.smText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.smSurface2, in: RoundedRectangle(cornerRadius: 7))
            }
        }
        .padding(10)
        .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.smBorder, lineWidth: 0.75))
    }

    // MARK: - Save toggle

    private var saveToggle: some View {
        Button(action: { savedConfirmed.toggle() }) {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(savedConfirmed ? Color.smAccent : Color.smSurface2)
                        .frame(width: 22, height: 22)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(savedConfirmed ? Color.smAccent : Color.smBorder, lineWidth: 0.75)
                        )
                    if savedConfirmed {
                        Image(systemName: "checkmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Color(hex: "#fbf8f1"))
                    }
                }
                Text("Я сохранил секретную фразу в надёжном месте")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.smText)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer()
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: - Badges

    private var encryptionBadge: some View {
        HStack(spacing: 5) {
            Image(systemName: "lock.fill").font(.system(size: 10))
            Text("Ключи генерируются на устройстве · фраза никогда не покидает устройство")
                .font(.system(size: 11.5))
                .tracking(-0.1)
        }
        .foregroundStyle(Color.smFaint)
        .multilineTextAlignment(.center)
        .padding(.top, 4)
    }

    private var loadingOverlay: some View {
        ZStack {
            Color.black.opacity(0.35).ignoresSafeArea()
            VStack(spacing: 12) {
                ProgressView().tint(Color.smAccent).scaleEffect(1.2)
                Text("Создание аккаунта…")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.smMuted)
            }
            .padding(28)
            .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.smBorder, lineWidth: 0.5))
        }
    }

    // MARK: - Validation

    private var isFormValid: Bool {
        let u = username.trimmingCharacters(in: .whitespaces)
        let d = displayName.trimmingCharacters(in: .whitespaces)
        return u.count >= 2 && !d.isEmpty && savedConfirmed && mnemonic.components(separatedBy: " ").count == 24
    }

    // MARK: - Actions

    private func generateInitialMnemonicIfNeeded() {
        guard mnemonic.isEmpty else { return }
        generateMnemonic()
    }

    private func generateMnemonic() {
        guard let phrase = try? SunCrypto.generateMnemonic() else { return }
        copyResetTask?.cancel()
        copyResetTask = nil
        mnemonic = phrase
        mnemonicCopied = false
        savedConfirmed = false
    }

    private func copyMnemonic() {
        UIPasteboard.general.string = mnemonic
        mnemonicCopied = true
        copyResetTask?.cancel()
        copyResetTask = Task {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                guard !Task.isCancelled else { return }
                copyResetTask = nil
                mnemonicCopied = false
            }
        }
    }

    private func handleRegister() {
        focusedField = nil
        let trimUser = username.trimmingCharacters(in: .whitespaces).lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "@"))
        let trimName = displayName.trimmingCharacters(in: .whitespaces)
        let phrase = mnemonic

        guard trimUser.count >= 2, !trimName.isEmpty else {
            step = .error("Please fill in all fields.")
            return
        }
        step = .loading

        Task {
            do {
                let api = APIClient.shared

                // 1. CSRF token (fast network call first)
                api.resetAuthSession()
                let csrf = try await api.getCsrfToken()
                api.csrfToken = csrf

                // 2. RSA-2048 key gen — run detached so it doesn't block cooperative pool;
                //    awaiting .value resumes back on MainActor automatically.
                let (privatePEM, publicPEM): (String, String) = try await Task.detached(priority: .userInitiated) {
                    try SunCrypto.generateRSAKeyPair()
                }.value

                // 3. Vault stores PKCS#8 so the web client can also log in
                let pkcs8PEM = SunCrypto.convertToPKCS8PEM(privatePEM)
                let vault = try SunCrypto.encryptVault(privateKeyPEM: pkcs8PEM, mnemonic: phrase)

                // 4. Get register challenge
                let challenge = try await api.getRegisterChallenge()

                // 5. Sign challenge
                let signature = try SunCrypto.rsaSign(challenge, privateKeyPEM: privatePEM)

                // 6. Register
                try await api.registerClient(
                    username: trimUser,
                    displayName: trimName,
                    publicKeyPEM: publicPEM,
                    loginVault: vault,
                    challenge: challenge,
                    signature: signature
                )

                // 7. Store private key in Keychain, load session
                try? KeychainService.savePrivateKey(privatePEM)
                await session.loadBootstrap()

            } catch let apiErr as APIError {
                await MainActor.run { step = .error(apiErr.localizedDescription) }
            } catch {
                await MainActor.run { step = .error(error.localizedDescription) }
            }
        }
    }
}
