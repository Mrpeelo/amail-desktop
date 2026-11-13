/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Developer diagnostic for features in progress. Only runs when the
 * AMAIL_DEBUG_CHECKS environment variable lists check names (comma
 * separated); writes amail-debug.json to the profile and quits.
 *
 * Keep only checks for unconfirmed work: remove a check once the feature is
 * confirmed.
 */

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Ask scratchpad screen-watch.ps1 (run next to the test) for a capture of the
 * whole screen, which includes open menus.
 */
async function screenShot(name) {
  const dir = PathUtils.profileDir;
  const done = PathUtils.join(dir, "amail-shot-done");
  await IOUtils.remove(done, { ignoreAbsent: true });
  await IOUtils.writeUTF8(PathUtils.join(dir, "amail-shot-request"), name);
  for (let i = 0; i < 25 && !(await IOUtils.exists(done)); i++) {
    await wait(200);
  }
}

/**
 * Save a picture of the main window as amail-debug-<name>.png in the profile.
 */
async function snapshot(
  name,
  win = window.browsingContext.topChromeWindow,
  rect = null
) {
  const top = win;
  const bitmap = await top.browsingContext.currentWindowGlobal.drawSnapshot(
    rect,
    rect ? 2 : 1,
    "white"
  );
  const canvas = new top.OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  await IOUtils.write(
    PathUtils.join(PathUtils.profileDir, `amail-debug-${name}.png`),
    new Uint8Array(await blob.arrayBuffer())
  );
}

/**
 * Checks by name. Each receives a function to record results.
 *
 * @type {Record<string, function(function(object): void): Promise<void>>}
 */
const CHECKS = {
  /** Calendar restyle on a temporary calendar of sample events. */
  async "calendar-restyle"(record) {
    const top = window.browsingContext.topChromeWindow;
    top.resizeTo(1920, 1040);
    await wait(800);
    const { cal } = ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs");
    const { CalEvent } = ChromeUtils.importESModule("resource:///modules/CalEvent.sys.mjs");
    const { CalAttendee } = ChromeUtils.importESModule("resource:///modules/CalAttendee.sys.mjs");
    const { MailServices } = ChromeUtils.importESModule(
      "resource:///modules/MailServices.sys.mjs"
    );
    const identity = MailServices.accounts.defaultAccount.defaultIdentity;
    Services.prefs.setStringPref("calendar.category.color.amailtestwork", "#d13438");
    Services.prefs.setStringPref("calendar.category.color.amailtestpersonal", "#107c10");

    const calendar = cal.manager.createCalendar("memory", Services.io.newURI("moz-memory-calendar://amail-test"));
    calendar.name = "aMail test";
    calendar.setProperty("color", "#0f6cbd");
    calendar.setProperty("imip.identity.key", identity.key);
    cal.manager.registerCalendar(calendar);

    const monday = cal.dtz.now();
    monday.isDate = false;
    monday.hour = 0;
    monday.minute = 0;
    monday.second = 0;
    monday.day -= (monday.weekday + 6) % 7;
    const at = (dayOffset, hour, len = 1) => {
      const start = monday.clone();
      start.day += dayOffset;
      start.hour = hour;
      const end = start.clone();
      end.hour += len;
      return [start, end];
    };
    const make = (title, [start, end], props = {}) => {
      const ev = new CalEvent();
      ev.title = title;
      ev.startDate = start;
      ev.endDate = end;
      for (const [k, v] of Object.entries(props.p ?? {})) {
        ev.setProperty(k, v);
      }
      if (props.categories) {
        ev.setCategories(props.categories);
      }
      if (props.partstat) {
        const org = new CalAttendee();
        org.id = "mailto:organizer@example.com";
        org.isOrganizer = true;
        ev.organizer = org;
        const me = new CalAttendee();
        me.id = `mailto:${identity.email}`;
        me.participationStatus = props.partstat;
        ev.addAttendee(me);
      }
      return ev;
    };
    const events = [
      make("Busy: team meeting", at(0, 9, 1)),
      make("Category work", at(0, 11, 1), { categories: ["amailtestwork"] }),
      make("Tentative status", at(1, 9, 2), { p: { STATUS: "TENTATIVE" } }),
      make("Free: focus time", at(1, 13, 2), { p: { TRANSP: "TRANSPARENT" } }),
      make("Cancelled", at(2, 10, 1), { p: { STATUS: "CANCELLED" } }),
      make("Invite accepted", at(2, 13, 1), { partstat: "ACCEPTED", categories: ["amailtestpersonal"] }),
      make("Invite maybe", at(3, 9, 1), { partstat: "TENTATIVE" }),
      make("Invite declined", at(3, 11, 1), { partstat: "DECLINED" }),
      make("Invite unanswered", at(4, 10, 1), { partstat: "NEEDS-ACTION" }),
    ];
    for (const ev of events) {
      await calendar.addItem(ev);
    }

    const tabmail = top.document.getElementById("tabmail");
    tabmail.openTab("calendar");
    await wait(2500);
    const doc = top.document;
    const header = [...doc.querySelectorAll("#calendarViewHeader button:not([hidden]), #calendarViewHeader .view-header")]
      .filter(e => e.getBoundingClientRect().width)
      .map(e => e.textContent.trim() || e.id);
    record({
      label: "bar",
      header,
      todayPane: doc.getElementById("today-pane-panel").getBoundingClientRect().width,
      todayButtonStatus: doc.getElementById("calendar-show-todaypane-panel")?.getBoundingClientRect().width,
      commandBar: doc.querySelector("unified-toolbar")?.getBoundingClientRect().height,
      eventsListHidden: doc.getElementById("bottom-events-box").hidden,
      findPressed: doc.getElementById("amailFindEventsButton").ariaPressed,
      viewMenuMultiweek: !!doc.getElementById("calChangeViewMultiweek"),
    });

    top.switchCalendarView("multiweek");
    await wait(1200);
    record({ label: "multiweek maps to", view: top.currentView().type });

    for (const view of ["week", "month"]) {
      top.switchCalendarView(view);
      await wait(2500);
      const items = [...doc.querySelectorAll(`#${view}-view .calendar-color-box`)]
        .filter(el => el.mOccurrence?.calendar?.id == calendar.id)
        .map(el => {
          const cs = top.getComputedStyle(el);
          const label = el.querySelector(".event-name-label");
          return {
            title: el.mOccurrence.title,
            showAs: el.getAttribute("amail-showas"),
            inv: el.getAttribute("invitation-status"),
            bg: cs.backgroundColor,
            hatched: cs.backgroundImage.includes("stroke-opacity"),
            opacity: cs.opacity,
            strike: cs.textDecorationLine,
            icon: label ? top.getComputedStyle(label, "::before").backgroundImage.slice(0, 60) : null,
            bgImage: cs.backgroundImage.slice(0, 120),
            bgSize: `${cs.backgroundSize} ${cs.backgroundRepeat} ${cs.backgroundClip}`,
            covering: [...el.querySelectorAll("*")]
              .filter(c => top.getComputedStyle(c).backgroundColor != "rgba(0, 0, 0, 0)")
              .map(c => `${c.className || c.localName}: ${top.getComputedStyle(c).backgroundColor}`)
              .slice(0, 4),
          };
        });
      record({ label: `${view} items`, scrollTop: doc.querySelector("#week-view .multiday-grid")?.scrollTop, items });
      await snapshot(`cal-${view}`, top);
      if (view == "week") {
        await snapshot("cal-week-zoom", top, new top.DOMRect(350, 330, 1150, 320));
      }
    }

    doc.getElementById("amailFindEventsButton").click();
    await wait(1200);
    record({
      label: "find events toggle",
      shown: !doc.getElementById("bottom-events-box").hidden,
      pressed: doc.getElementById("amailFindEventsButton").ariaPressed,
    });
    await snapshot("cal-find", top);
    doc.getElementById("amailFindEventsButton").click();
    await wait(800);

    tabmail.closeTab(tabmail.currentTabInfo);
    cal.manager.unregisterCalendar(calendar);
    cal.manager.removeCalendar(calendar);
    record({ label: "cleanup", calendars: cal.manager.getCalendars().map(c => c.name) });
  },
};

export async function runDebugChecks(names) {
  const out = [];
  const file = PathUtils.join(PathUtils.profileDir, "amail-debug.json");
  // Written after every entry, so a check that hangs still shows how far
  // it got.
  const record = entry => {
    out.push(entry);
    IOUtils.writeJSON(file, out).catch(console.error);
  };
  await wait(4000);
  for (const name of names) {
    const check = CHECKS[name];
    if (!check) {
      record({ label: `ERROR unknown check ${name}` });
      continue;
    }
    try {
      await check(record);
    } catch (error) {
      record({ label: `ERROR ${name}: ${error}`, stack: error.stack });
    }
  }
  await IOUtils.writeJSON(
    PathUtils.join(PathUtils.profileDir, "amail-debug.json"),
    out
  );
  Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
}
