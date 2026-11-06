import VoiceRecorder from '@/components/voice/VoiceRecorder';

export default function VoicePage() {
  return (
    <div className="pt-2">
      <h1 className="text-[22px] font-bold tracking-tight">Voice note</h1>
      <p className="mb-8 mt-1 text-sm text-[#5b7266]">Speak for a few seconds. Buk writes it down, adds a short summary and three tags, and makes it searchable.</p>
      <VoiceRecorder />
      <p className="mt-10 text-center text-xs text-[#5b7266]">The recording is not stored. It is sent for transcription and then discarded.</p>
    </div>
  );
}
