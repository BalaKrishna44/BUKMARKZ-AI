import * as React from 'react';
import { Html, Head, Preview, Body, Container, Section, Row, Column, Heading, Text, Link, Button, Hr, Img } from '@react-email/components';

export interface FridayTurn { who: 'markz' | 'buk'; text: string }
export interface FridayJokeDigestProps {
  turns: FridayTurn[];
  ctaUrl: string;
  ctaLabel?: string;               // default "Flush Open Tabs into Vault". We cannot know how many tabs someone has open, so there is no number in it unless you pass one.
  shareHref: string;               // a mailto: that pre-fills the joke and the sender's referral link
  rewardCopy?: string;             // must describe a reward that really exists
  weekSaves?: number;
  assetBase: string;               // where buk.png and markz.png are hosted, e.g. https://bukmarkz.com/email
  unsubscribeUrl: string;
}

// Email clients ignore backdrop-filter, so the "glass" is faked: translucent white panels, hairline borders, and a solid slate fallback behind them.
const C = { bg: '#020617' /* slate-950 */, solid: '#0f172a' /* slate-900 */, glass: 'rgba(255,255,255,0.06)', line: 'rgba(255,255,255,0.14)', text: '#f1f5f9', mute: '#94a3b8', em: '#34d399' /* emerald-400 */, emInk: '#022c22', emGlass: 'rgba(52,211,153,0.14)', emLine: 'rgba(52,211,153,0.40)' };
const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const NAME = { markz: 'Markz', buk: 'Buk' } as const;
export const DEFAULT_CTA = 'Flush Open Tabs into Vault';

function Avatar({ who, base }: { who: 'markz' | 'buk'; base: string }) {
  return (
    <div style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: who === 'markz' ? '#1f2a1c' : '#10261c', border: `1px solid ${who === 'markz' ? C.emLine : C.line}`, overflow: 'hidden', textAlign: 'center' }}>
      <Img src={`${base}/${who}.png`} width="40" height="40" alt={NAME[who]} style={{ display: 'block', margin: '2px auto 0' }} />
    </div>
  );
}

export default function FridayJokeDigest({ turns, ctaUrl, ctaLabel = DEFAULT_CTA, shareHref, rewardCopy = 'You both get 30 days of Pro once they save their first 5 links.', weekSaves = 0, assetBase, unsubscribeUrl }: FridayJokeDigestProps) {
  const base = assetBase.replace(/\/$/, '');
  return (
    <Html lang="en">
      <Head><meta name="color-scheme" content="dark" /><meta name="supported-color-schemes" content="dark" /></Head>
      <Preview>{`Markz: ${turns[0]?.text ?? ''}`}</Preview>
      <Body style={{ margin: 0, padding: '24px 12px', backgroundColor: C.bg, fontFamily: font, color: C.text }}>
        <Container style={{ maxWidth: 560, margin: '0 auto' }}>
          <Text style={{ margin: '0 0 6px', fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', color: C.em, fontWeight: 700 }}>Friday Vault After-Hours</Text>
          <Heading as="h1" style={{ margin: '0 0 16px', fontSize: 24, lineHeight: '30px', color: C.text }}>Markz and Buk have clocked out. Mostly.</Heading>

          {/* the dialogue box */}
          <Section style={{ backgroundColor: C.solid, background: C.glass, border: `1px solid ${C.line}`, borderRadius: 18, padding: '16px 14px', marginBottom: 14 }}>
            {turns.map((t, i) => {
              const left = t.who === 'markz';
              const bubble = (
                <Column style={{ verticalAlign: 'top' }}>
                  <Text style={{ margin: '0 0 3px', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: left ? C.em : C.mute, textAlign: left ? 'left' : 'right' }}>{NAME[t.who]}</Text>
                  <div style={{ backgroundColor: left ? '#0d2a22' : '#16213a', background: left ? C.emGlass : 'rgba(148,163,184,0.14)', border: `1px solid ${left ? C.emLine : C.line}`, borderRadius: left ? '4px 14px 14px 14px' : '14px 4px 14px 14px', padding: '10px 13px', fontSize: 15, lineHeight: '22px', color: C.text }}>{t.text}</div>
                </Column>
              );
              const av = <Column style={{ width: 54, verticalAlign: 'top', paddingTop: 16 }}><Avatar who={t.who} base={base} /></Column>;
              return (
                <Row key={i} style={{ marginBottom: i === turns.length - 1 ? 0 : 12 }}>
                  {left ? <>{av}{bubble}<Column style={{ width: 22 }} /></> : <><Column style={{ width: 22 }} />{bubble}<Column style={{ width: 54, verticalAlign: 'top', paddingTop: 16, paddingLeft: 10 }}><Avatar who={t.who} base={base} /></Column></>}
                </Row>
              );
            })}
          </Section>

          {weekSaves > 0 && <Text style={{ margin: '0 0 14px', fontSize: 14, color: C.mute, textAlign: 'center' }}>You saved {weekSaves} link{weekSaves === 1 ? '' : 's'} this week. Buk noticed.</Text>}

          <Section style={{ textAlign: 'center', padding: '4px 0 6px' }}>
            <Button href={ctaUrl} style={{ backgroundColor: C.em, color: C.emInk, fontWeight: 700, fontSize: 16, padding: '14px 26px', borderRadius: 12, textDecoration: 'none', display: 'inline-block' }}>{ctaLabel}</Button>
            <Text style={{ margin: '10px 0 0', fontSize: 12, color: C.mute }}>Opens your vault. Then press <b>Flush session</b> in the Bukmarkz extension: one click saves the window and closes the clutter.</Text>
          </Section>

          {/* referral card */}
          <Section style={{ backgroundColor: C.solid, background: C.glass, border: `1px solid ${C.emLine}`, borderRadius: 16, padding: '16px 18px', margin: '18px 0 0' }}>
            <Text style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: C.text }}>Know someone with 47 tabs open?</Text>
            <Text style={{ margin: '0 0 12px', fontSize: 14, lineHeight: '20px', color: C.mute }}>Share this joke with a friend. {rewardCopy}</Text>
            <Button href={shareHref} style={{ backgroundColor: 'transparent', color: C.em, border: `1px solid ${C.em}`, fontWeight: 600, fontSize: 14, padding: '10px 18px', borderRadius: 10, textDecoration: 'none', display: 'inline-block' }}>Send it to a friend</Button>
          </Section>

          <Hr style={{ borderColor: C.line, margin: '22px 0 12px' }} />
          <Text style={{ margin: 0, fontSize: 12, lineHeight: '18px', color: C.mute, textAlign: 'center' }}>
            You get this on Friday afternoons because you turned on Friday Vault After-Hours. <Link href={unsubscribeUrl} style={{ color: C.mute, textDecoration: 'underline' }}>Unsubscribe in one click</Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
