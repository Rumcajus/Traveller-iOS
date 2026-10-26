# Mapa Podróży — aplikacja na iPhone (PWA, 100% offline)

Zaznaczaj odwiedzone kraje i miasta na mapie świata. Odwiedzone kraje zmieniają kolor, nieodwiedzone są beżowe.
Panel statystyk pokazuje, ile krajów już odwiedziłeś i ile jeszcze zostało.

## Co jest w środku
- katalog główny repozytorium — gotowa aplikacja (publikowana przez GitHub Pages)
- `tools/build.mjs` — skrypt generujący dane mapy i miast (nie jest potrzebny do działania aplikacji)

## Jak zainstalować na iPhonie
Aplikację trzeba **jeden raz** otworzyć z adresu https, żeby iPhone mógł ją zainstalować. Potem działa bez internetu.

### GitHub Pages (darmowe)
1. Załóż konto na https://github.com i utwórz nowe **publiczne** repozytorium, np. `mapa-podrozy`.
2. Kliknij **Add file → Upload files** i przeciągnij **zawartość** tego repozytorium (pliki `index.html`, `app.js`, … oraz foldery `data` i `icons`). Zatwierdź przyciskiem **Commit changes**.
3. Wejdź w **Settings → Pages**. W sekcji „Build and deployment” wybierz **Deploy from a branch**, gałąź `main`, folder `/ (root)` i kliknij **Save**.
4. Po 1–2 minutach aplikacja będzie dostępna pod adresem `https://TWOJA-NAZWA.github.io/mapa-podrozy/`.

W repozytorium jest tylko kod aplikacji. Twoje dane o podróżach zostają w telefonie.

### Instalacja na iPhonie
1. Otwórz ten adres w **Safari**.
2. Stuknij **Udostępnij** → **Do ekranu początkowego** → **Dodaj**.
3. Uruchom aplikację z ikony na ekranie początkowym i odczekaj kilka sekund. W **Ustawienia → Tryb offline** powinien pojawić się napis „gotowy ✓”. Od tej chwili aplikacja działa w trybie samolotowym.

Ważne: zaznaczaj kraje w aplikacji uruchomionej z ikony, a nie w karcie Safari. To są dwa osobne miejsca na dane.

## Funkcje
- Interaktywna mapa świata: przesuwanie, szczypanie, przyciski + / − / cały świat.
- Stuknij kraj, żeby otworzyć jego kartę: „Byłem tutaj”, lista miast, „Pokaż na mapie”.
- Miasta z wbudowanej bazy (~50 tys. miejscowości powyżej 5 tys. mieszkańców, z polskimi nazwami, np. Rzym, Monachium) pojawiają się na mapie jako kropki.
- Własne miejsca spoza bazy: wpisz nazwę i opcjonalnie „Wskaż na mapie”.
- Lista krajów z wyszukiwarką, filtrami i postępem na każdym kontynencie.
- Statystyki: odwiedzone i pozostałe kraje (z 197), procent świata, liczba miast, kontynenty, procent powierzchni lądów i ludności świata, ranking krajów według liczby miast.
- Wybór koloru odwiedzonych krajów, tryb ciemny, kopia zapasowa do pliku (eksport i import).
- Małe państwa (Watykan, Monako, Malta, wyspy Pacyfiku) mają na mapie kółka, które łatwo trafić palcem.
- Liczone kraje: 193 państwa ONZ, Watykan, Palestyna, Kosowo i Tajwan (razem 197). Terytoria zależne (Grenlandia, Portoryko itp.) można zaznaczać osobno.

## Kopia zapasowa
Dane są zapisane tylko w telefonie. Co jakiś czas wybierz **Ustawienia → Eksportuj dane** i zapisz plik w aplikacji Pliki lub w iCloud.
Jeśli usuniesz aplikację z ekranu początkowego, jej dane też zostaną usunięte. Dane przywrócisz przez **Importuj dane z pliku**.

## Aktualizacja aplikacji
Po zmianie plików zwiększ numer w `CACHE` w pliku `sw.js` (np. `mapa-podrozy-1.0.1`) i wgraj pliki ponownie.
Aplikacja pobierze nową wersję przy najbliższym uruchomieniu z dostępem do internetu.

## Źródła danych
Granice państw: Natural Earth (domena publiczna). Miasta: GeoNames (CC BY 4.0), przez pakiet `all-the-cities`.
Plan Warszawy (ulice, woda, zieleń): © współtwórcy OpenStreetMap, licencja ODbL, pobrane z Overture Maps
(`tools/overture_fetch.py` pobiera dane, `tools/warsaw_build.py` buduje `data/warsaw.json`).
