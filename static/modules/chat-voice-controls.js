export function createVoiceRecorderControls(voiceRecorderController) {
    return {
        isVoiceRecordSupported() {
            return voiceRecorderController.isSupported();
        },
        isVoiceRecordingActive() {
            return voiceRecorderController.isActive();
        },
        updateVoiceRecordButtonState() {
            voiceRecorderController.updateButtonState();
        },
        async stopVoiceRecording(options = {}) {
            return voiceRecorderController.stop(options);
        },
        async startVoiceRecording() {
            return voiceRecorderController.start();
        },
    };
}
