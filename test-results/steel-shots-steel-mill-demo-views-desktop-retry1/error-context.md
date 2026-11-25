# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: steel-shots.spec.ts >> steel mill demo views
- Location: tests/e2e/steel-shots.spec.ts:10:5

# Error details

```
Test timeout of 240000ms exceeded.
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - complementary [ref=e3]:
      - generic [ref=e4]:
        - img "SK Infra" [ref=e5]
        - generic [ref=e6]: SK Management
      - button "Vaihda yritystä" [ref=e8]:
        - generic [ref=e13]: SK Infra Demo
      - navigation "Päävalikko" [ref=e17]:
        - link "Etusivu" [ref=e18] [cursor=pointer]:
          - /url: /c/sk-infra-demo/dashboard
        - button "Projektit" [ref=e25]
        - button "Tuotannonohjaus" [ref=e32]
        - link "Työturvallisuus" [ref=e40] [cursor=pointer]:
          - /url: /c/sk-infra-demo/hse
        - button "Henkilöstö" [ref=e47]
        - link "Kalusto" [ref=e56] [cursor=pointer]:
          - /url: /c/sk-infra-demo/equipment
      - generic [ref=e62]:
        - generic [ref=e63]:
          - generic [ref=e64]: Riikka Harjoitus
          - generic [ref=e65]: hse@skinfra.example.com
        - form "Kieli" [ref=e66]:
          - button "Suomi" [pressed] [ref=e67]
          - button "English" [ref=e68]
        - button "Kirjaudu ulos" [ref=e70]
    - main [ref=e74]:
      - generic [ref=e75]:
        - generic [ref=e76]:
          - link "Työturvallisuus" [ref=e77] [cursor=pointer]:
            - /url: /c/sk-infra-demo/hse
          - heading "Turvallisuushavainto" [level=1] [ref=e82]
        - generic [ref=e84]:
          - heading "NSM-001 · Nordic Steel Mill Demo" [level=2] [ref=e86]
          - generic [ref=e87]:
            - generic [ref=e88]:
              - generic [ref=e89]:
                - text: Ilmoituksen tyyppi
                - generic [aria-hidden] [ref=e90]: "*"
              - combobox "Ilmoituksen tyyppi" [ref=e91]:
                - option "Turvallisuushavainto" [selected]
                - option "Läheltä piti"
            - generic [ref=e92]:
              - generic [ref=e93]: Aihe
              - combobox "Aihe" [ref=e94]:
                - option "Suojaimet"
                - option "Järjestys ja siisteys"
                - option "Korkealla työskentely"
                - option "Nostot"
                - option "Kaivannot"
                - option "Sähkötyöt"
                - option "Liikenne"
                - option "Koneet"
                - option "Ympäristö"
                - option "Muu" [selected]
            - generic [ref=e95]:
              - generic [ref=e96]:
                - text: Mitä havaitsit / tapahtui?
                - generic [aria-hidden] [ref=e97]: "*"
              - textbox "Mitä havaitsit / tapahtui?" [ref=e98]
            - generic [ref=e99]:
              - generic [ref=e100]: Vakavuus
              - combobox "Vakavuus" [ref=e101]:
                - option "Vähäinen" [selected]
                - option "Kohtalainen"
                - option "Vakava"
            - generic [ref=e102]:
              - generic [ref=e103]:
                - text: Milloin
                - generic [aria-hidden] [ref=e104]: "*"
              - textbox "Milloin" [ref=e105]: 2026-11-25T19:35
            - generic [ref=e106]:
              - generic [ref=e107]: Työmaa
              - combobox "Työmaa" [ref=e108]:
                - option "Ei valittu" [selected]
                - option "110 kV Substation"
                - option "Logistics Yard"
                - option "Sulatto (EAF)"
            - generic [ref=e109]:
              - generic [ref=e110]: Paikka
              - textbox "Paikka" [ref=e111]
            - generic [ref=e112]:
              - generic [ref=e113]: Liittyvä nostosuunnitelma
              - combobox "Liittyvä nostosuunnitelma" [ref=e114]:
                - option "Ei mitään" [selected]
                - option "Uunimuuntajan nosto perustukselle"
                - option "Nosturiradan palkkien nosto +12 m tasolle"
            - generic [ref=e115]:
              - generic [ref=e116]: Kuvaus
              - textbox "Kuvaus" [ref=e117]
            - generic [ref=e119]:
              - generic [ref=e120]: Kuva
              - button "Kuva" [ref=e121]
              - paragraph [ref=e122]: Ota kuva puhelimen kameralla tai valitse tiedosto.
            - button "Lähetä ilmoitus" [ref=e124]
  - alert [ref=e125]
```