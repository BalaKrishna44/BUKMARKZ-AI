import * as React from 'react';
import { Html, Head, Preview, Body, Container, Section, Row, Column, Heading, Text, Link, Button, Hr } from '@react-email/components';

export interface DigestRow { id: string; title: string; host: string; age: string; recap: string; href: string }
export interface WeeklyDigestEmailProps { rows: DigestRow[]; quizUrl: string; unsubscribeUrl: string; prompt?: string }

// Buk's memory check-ins; one is picked per ISO week so the email feels fresh but a retry is identical.
export const CHECKIN_PROMPTS = [
  'Before you open them: which one do you remember saving, and why?',
  'Pick the one you think you still need. Then see if you were right.',
  'Which of these would you recommend to a friend today?',
  'Which one can you explain in a single sentence, without looking?',
];
export const pickPrompt = (week: number) => CHECKIN_PROMPTS[week % CHECKIN_PROMPTS.length];

// Email clients ignore backdrop-filter, so the "glass" is faked: translucent rgba panels, hairline borders, and a solid fallback colour behind them.
const C = { bg: '#0b1220', panel: 'rgba(255,255,255,0.06)', panelSolid: '#131c2e', line: 'rgba(255,255,255,0.14)', text: '#e8eef7', mute: '#93a1b8', em: '#34d399', emInk: '#04130d' };
const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export default function WeeklyDigestEmail({ rows, quizUrl, unsubscribeUrl, prompt = CHECKIN_PROMPTS[0] }: WeeklyDigestEmailProps) {
  return (
    <Html lang="en">
      <Head><meta name="color-scheme" content="dark" /><meta name="supported-color-schemes" content="dark" /></Head>
      <Preview>{`Buk found ${rows.length} links you saved and never opened.`}</Preview>
      <Body style={{ margin: 0, padding: '24px 12px', backgroundColor: C.bg, fontFamily: font, color: C.text }}>
        <Container style={{ maxWidth: 560, margin: '0 auto' }}>
          <Text style={{ margin: '0 0 14px', fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', color: C.em, fontWeight: 700 }}>Bukmarkz · Weekly memory check</Text>

          {/* Buk's check-in card */}
          <Section style={{ backgroundColor: C.panelSolid, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: '18px 20px', marginBottom: 14 }}>
            <Row>
              <Column style={{ width: 52, verticalAlign: 'top' }}>
                <div style={{ width: 40, height: 40, lineHeight: '40px', textAlign: 'center', borderRadius: 20, backgroundColor: C.em, color: C.emInk, fontWeight: 800, fontSize: 18 }}>B</div>
              </Column>
              <Column style={{ verticalAlign: 'top' }}>
                <Heading as="h1" style={{ margin: '0 0 6px', fontSize: 20, lineHeight: '26px', color: C.text }}>Buk here. You saved these and never came back.</Heading>
                <Text style={{ margin: 0, fontSize: 15, lineHeight: '22px', color: C.mute }}>{prompt}</Text>
              </Column>
            </Row>
          </Section>

          {rows.map((r, n) => (
            <Section key={r.id} style={{ backgroundColor: C.panelSolid, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: '14px 18px', marginBottom: 10 }}>
              <Text style={{ margin: '0 0 2px', fontSize: 12, color: C.mute }}>{n + 1} · {r.host || 'link'} · saved {r.age}</Text>
              <Link href={r.href} style={{ fontSize: 16, lineHeight: '22px', fontWeight: 600, color: C.text, textDecoration: 'none' }}>{r.title}</Link>
              <Text style={{ margin: '6px 0 0', fontSize: 14, lineHeight: '20px', color: C.mute }}><span style={{ color: C.em, fontWeight: 600 }}>Buk: </span>{r.recap}</Text>
            </Section>
          ))}

          <Section style={{ textAlign: 'center', padding: '12px 0 4px' }}>
            <Button href={quizUrl} style={{ backgroundColor: C.em, color: C.emInk, fontWeight: 700, fontSize: 16, padding: '14px 26px', borderRadius: 12, textDecoration: 'none', display: 'inline-block' }}>
              Open Vault &amp; Take Recall Quiz
            </Button>
          </Section>

          <Hr style={{ borderColor: C.line, margin: '22px 0 12px' }} />
          <Text style={{ margin: 0, fontSize: 12, lineHeight: '18px', color: C.mute, textAlign: 'center' }}>
            You get this once a week because you turned it on. <Link href={unsubscribeUrl} style={{ color: C.mute, textDecoration: 'underline' }}>Unsubscribe in one click</Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
