---
name: Command Deck
description: Warm orange-and-white operating workspace with a source-linked document studio
colors:
  action: "#b74325"
  action-hover: "#91341c"
  action-soft: "#f8e8de"
  canvas: "#f3f2ee"
  subtle: "#f8f7f4"
  surface: "#ffffff"
  ink: "#202725"
  muted: "#626a65"
  line: "#dedfd8"
  line-soft: "#e9e9e3"
  success: "#25734e"
  warning: "#805800"
  danger: "#ad3027"
  document-navy: "#183850"
  document-forest: "#235d46"
typography:
  display:
    fontFamily: "Manrope, 'Segoe UI', sans-serif"
    fontSize: "39px"
    fontWeight: 600
    lineHeight: 1.13
    letterSpacing: "-1.15px"
  headline:
    fontFamily: "Manrope, 'Segoe UI', sans-serif"
    fontSize: "36px"
    fontWeight: 750
    lineHeight: 1.15
    letterSpacing: "-1.1px"
  title:
    fontFamily: "Manrope, 'Segoe UI', sans-serif"
    fontSize: "17px"
    fontWeight: 750
    letterSpacing: "-0.3px"
  body:
    fontFamily: "Manrope, 'Segoe UI', sans-serif"
    fontSize: "13px"
    lineHeight: 1.8
  document-title:
    fontFamily: "Georgia, serif"
    fontSize: "32px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.7px"
  document-body:
    fontFamily: "Georgia, serif"
    fontSize: "14px"
    lineHeight: 1.85
  label:
    fontFamily: "Manrope, 'Segoe UI', sans-serif"
    fontSize: "11px"
rounded:
  control: "5px"
  field: "7px"
  navigation: "8px"
  panel: "14px"
  hero: "16px"
spacing:
  compact: "8px"
  cluster: "12px"
  group: "16px"
  section: "24px"
  rail: "30px"
  panel: "28px"
  workspace: "38px 44px 48px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
    textColor: "{colors.surface}"
  service-open:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "6px"
    padding: "7px 10px"
  input:
    backgroundColor: "{colors.subtle}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "11px"
  nav-active:
    backgroundColor: "{colors.action-soft}"
    textColor: "{colors.action-hover}"
    rounded: "{rounded.navigation}"
    padding: "11px 15px"
  conversation:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "26px"
  document-paper:
    backgroundColor: "{colors.surface}"
    typography: "{typography.document-body}"
    padding: "46px 42px"
---

# Design System: Command Deck

## Overview

Command Deck retains its orange-and-white brand in a warmer, quieter operating workspace. Strong headings, a single orange command surface, clear service actions and flat information rails make the next useful action visible. Manrope carries interface work; Georgia gives research documents a reading voice.

This refresh replaces the former Dashboard V14 composition on Home and the research studio. Existing tools retain their functions and source/review boundaries. The visual system supports real projects, service readiness, durable work and source-linked documents; decorative statistics cannot substitute for those records.

**Key Characteristics:**

- Warm canvas, white working surfaces and restrained orange actions.
- Flat launch and project rails with readable supporting text.
- A clear distinction between interface controls and the document itself.

## Colors

The palette combines burnt orange actions with warm mineral neutrals. Frontmatter values are normative; the final refresh stylesheet overrides the earlier theme palette.

### Primary

Action orange identifies the command surface, primary actions, citations and selected navigation. Its darker companion serves hover and focus; the pale tint supports selected navigation. Document navy and forest are selectable document accents, confined to the paper preview rather than global interface alternatives.

### Neutral

Canvas provides the workspace ground; white identifies working surfaces and paper. Subtle fills distinguish fields. Ink carries main content, muted carries supporting text, and line tokens organize rows. Success, warning and danger remain semantic states with visible text labels. Individual service readiness labels retain their existing local green and amber treatments.

**The Labeled State Rule.** State color always accompanies readable status text.

## Typography

Manrope is self-hosted through `/brand-font.ttf` with variable weights from 200 to 800 and `font-display: swap`. Segoe UI and sans-serif are interface fallbacks. Georgia and serif carry document reading text and document titles; document section headings and source metadata return to Manrope.

The headline role names the current workspace. The display role serves the command invitation, with responsive sizes from 32px to 45px. Section titles remain compact; body and label roles support dense operational information. Research conversation text uses a 13px size; paper body uses 14px. Paper titles step down to 27px on small screens. Document metadata sits below title and purpose in normal case, with no tracking.

## Layout

The desktop shell uses a 76px header and 228px navigation rail. Workspace content has a maximum width of 1620px. Default workspace padding follows the frontmatter; wide screens at 1600px use 44px 56px padding. At 1100px the padding reduces to 30px 26px; at 520px it becomes 28px 18px.

Home pairs the command invitation with local services, then a four-item launch rail and project/work rows. At 1100px launches become two columns and lower content stacks. At 850px the command/services pair and research studio stack into one column; the shell changes to a 66px header and an accessible mobile navigation drawer. Research pairs a conversation with a paper preview, allowing both to grow with their content. The complete chat stays visible in document flow; do not restore a fixed-height clipped transcript.

## Elevation & Depth

Surfaces are mostly flat: white against the warm canvas, with fine dividers between related records. The paper has a quiet shadow (`0 14px 36px #25352b0b`); mobile navigation has a structural shadow (`16px 8px 30px #172b221a`). Avoid repeating elevated cards for every project or launch action.

The command surface enters over 0.5s with an 8px upward settling motion and easing `cubic-bezier(.16,1,.3,1)`. Disable this animation for reduced motion.

## Shapes

Broad working surfaces use panel and hero radii; fields and controls use smaller corners. Paper remains rectangular. Project rows and launch rails are flat and divided, with no individual card silhouette. Service symbols use compact rounded squares. Keep non-color status labels and visible 3px focus outlines with a 3px offset.

## Components

### Buttons and fields

Primary actions use white on orange and a darker hover. The research create action spans its column and has a 45px minimum height. The command composer uses a white field with an ink action button. Fields use the subtle fill, a line border and gently curved corners; keep labels, disabled behavior, progress and errors visible. Reuse existing primary-button sizing where a surface does not override it.

### Navigation and service directory

Selected navigation uses the orange tint and dark orange text. Service rows pair a symbol, service name, labeled readiness and a real Open link. The optional Start action remains available where its caller provides it. Keep each service's own destination rather than sending every row to a generic page.

### Flat rails and working surfaces

Launches and projects are horizontal or stacked rows with separators and restrained directional icons. Research conversation and service groups use white containers; they do not require shadows. Use real empty states when there are no active tasks or saved documents.

### Research conversation and paper

The studio accepts public pages or research requests, collects source material and creates local documents. It exposes document kind, design, audience, purpose, source settings, saved research and revisions. Preserve citation markers, source links and collection notes. Put document title first, purpose second, then genre and audience metadata. Export actions offer Word, PDF, Web and Markdown. This presentation does not imply arbitrary model-powered rewriting beyond implemented source-based generation and revision behavior.

## Do's and Don'ts

- Do preserve the orange-and-white identity while using the warm canvas and final refresh tokens.
- Do keep real service destinations, status text, source citations and existing review gates visible.
- Do keep the entire research conversation accessible in document flow.
- Do use Georgia for reading and Manrope for operating controls.
- Don't restore the removed Volunteer sync or Service desk interface.
- Don't invent metrics, deploy claims or unrestricted document-writing capabilities.
- Don't turn project rows and launch actions into repeated elevated cards.
- Don't apply the studio palette to client-sector previews that have their own design brief.
