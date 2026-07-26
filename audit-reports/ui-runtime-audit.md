# UI runtime audit

Base revision: `006c3249b387e72e5033ea9a20630dc7637934b2`

## Confirmed findings

1. The Play page throws a parse error, leaves the board empty, and cannot select a time control.
2. Shared primary navigation is built from pointer-only `div` elements and is skipped by keyboard focus.
3. The account menu lacks expanded state, keyboard-reachable actions, and Escape handling.
4. The mobile Play layout is fixed at about 1300 px wide.
5. Theory renders at about 1400 px on a 390 px viewport while horizontal overflow is hidden.
6. The shared mobile header is about 703 px wide and pushes navigation and utility controls offscreen.
7. Watch keeps a multi-column grid on phones.
8. Settings controls have empty accessible names and invisible toggle focus.
9. Login and signup labels are not programmatically associated with inputs.

## Evidence

- Installed Chrome was exercised at 1440x900 and 390x844 across every declared route.
- Keyboard tab order, menu behavior, accessibility-tree names, layout widths, and screenshots were inspected.
- All original routes returned HTTP 200; authenticated Arena/Profile states redirected to Login and remain unverified.
- `git diff --exit-code` passed before this report was created.

No authenticated account, external service, or production state was changed.
