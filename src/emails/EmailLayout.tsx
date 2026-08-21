import {
  Body,
  Column,
  Container,
  Font,
  Head,
  Html,
  Img,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

import {
  BG,
  CARD_BG,
  FG,
  FONT_SANS,
  footerStyle,
  HAIRLINE,
  microLabelStyle,
  RUBIK_WOFF2_URL,
  SPINE,
} from "./theme";

export interface EmailLayoutProps {
  preview: string;
  /** Origin for the masthead mark (`/icon-192.png` must be servable). */
  appUrl?: string;
  children: ReactNode;
  /** Footer contents — each template owns its own unsubscribe copy. */
  footer?: ReactNode;
}

const DEFAULT_APP_URL = "https://brackeys.community";

/**
 * The one shell every email renders into: dark table wrapper (Outlook's
 * Word engine ignores CSS backgrounds on `<body>`, so the `bgcolor`
 * attribute carries the palette there), color-scheme meta so dark-mode
 * clients don't auto-invert the palette, Rubik via `<Font>` with a real
 * sans fallback, and the app's visual language — the masthead mark, a
 * Well-style card with the OG cards' tri-colour spine along its top, and
 * a dim footer below the card.
 */
export function EmailLayout({
  preview,
  appUrl = DEFAULT_APP_URL,
  children,
  footer,
}: EmailLayoutProps) {
  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="dark" />
        <meta name="supported-color-schemes" content="dark" />
        <Font
          fontFamily="Rubik"
          fallbackFontFamily={["Helvetica", "Arial", "sans-serif"]}
          webFont={{ url: RUBIK_WOFF2_URL, format: "woff2" }}
          fontWeight={400}
          fontStyle="normal"
        />
        <Font
          fontFamily="Rubik"
          fallbackFontFamily={["Helvetica", "Arial", "sans-serif"]}
          webFont={{ url: RUBIK_WOFF2_URL, format: "woff2" }}
          fontWeight={700}
          fontStyle="normal"
        />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={bodyStyle}>
        <table
          width="100%"
          border={0}
          cellPadding={0}
          cellSpacing={0}
          bgcolor={BG}
          role="presentation"
          style={{ backgroundColor: BG }}
        >
          <tbody>
            <tr>
              <td>
                <Container style={containerStyle}>
                  <Section style={mastheadStyle}>
                    <Row>
                      <Column style={{ width: "40px", verticalAlign: "middle" }}>
                        <Img
                          src={`${appUrl}/icon-192.png`}
                          width="28"
                          height="28"
                          alt="Brackeys"
                          style={markStyle}
                        />
                      </Column>
                      <Column style={{ verticalAlign: "middle" }}>
                        <Text style={microLabelStyle}>Brackeys Community</Text>
                      </Column>
                    </Row>
                  </Section>
                  <table
                    width="100%"
                    border={0}
                    cellPadding={0}
                    cellSpacing={0}
                    bgcolor={CARD_BG}
                    role="presentation"
                    style={cardStyle}
                  >
                    <tbody>
                      <tr>
                        {SPINE.map((color, idx) => (
                          <td
                            key={color}
                            style={{
                              ...spineCellStyle,
                              backgroundColor: color,
                              borderTopLeftRadius: idx === 0 ? "12px" : undefined,
                              borderTopRightRadius: idx === SPINE.length - 1 ? "12px" : undefined,
                            }}
                          />
                        ))}
                      </tr>
                      <tr>
                        <td colSpan={SPINE.length} style={cardBodyStyle}>
                          {children}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <Section style={{ marginTop: "20px" }}>
                    {footer}
                    <Text style={footerStyle}>
                      Brackeys Community — a home for game developers.
                    </Text>
                  </Section>
                </Container>
              </td>
            </tr>
          </tbody>
        </table>
      </Body>
    </Html>
  );
}

const bodyStyle = {
  backgroundColor: BG,
  color: FG,
  fontFamily: FONT_SANS,
  margin: 0,
  padding: 0,
};
const containerStyle = { margin: "0 auto", padding: "40px 24px", maxWidth: "560px" };
const mastheadStyle = { marginBottom: "20px" };
const markStyle = { borderRadius: "6px" };
const cardStyle = {
  backgroundColor: CARD_BG,
  border: `1px solid ${HAIRLINE}`,
  borderRadius: "12px",
};
/** fontSize/lineHeight zeroed so empty cells can't collapse or inflate. */
const spineCellStyle = {
  height: "4px",
  lineHeight: "4px",
  fontSize: "0",
  width: "33.33%",
};
const cardBodyStyle = { padding: "28px" };
