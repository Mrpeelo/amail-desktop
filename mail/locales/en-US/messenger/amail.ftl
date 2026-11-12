# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## aMail top bar

amail-app-name = { -brand-short-name }

amail-app-switch =
    .aria-label = Switch between mail and calendar

amail-go-mail = Mail
    .title = Mail

amail-go-calendar = Calendar
    .title = Calendar

amail-get-messages =
    .title = Get new messages for all accounts (Shift+F5)
    .aria-label = Get messages

amail-address-book =
    .title = Address Book
    .aria-label = Address Book

amail-settings =
    .title = Settings
    .aria-label = Settings

## Full Thunderbird profile import

amail-import-title = Import from Thunderbird
amail-import-heading = Import your Thunderbird profile
amail-import-intro = { -brand-short-name } makes a complete copy of a Thunderbird or Betterbird profile: accounts, mail, passwords and sign-ins, filters, junk training, trusted senders, signatures, address books, calendars, add-ons and settings.
amail-import-choose = Profile to import
amail-import-none-found = No Thunderbird or Betterbird profiles were found for this Windows user. Choose a profile folder instead.
amail-import-choose-folder = Choose profile folder…
amail-import-choose-folder-title = Choose a Thunderbird profile folder
amail-import-not-a-profile = That folder is not a Thunderbird profile (no prefs.js inside).
amail-import-warning = The copy replaces the current { -brand-short-name } profile, and { -brand-short-name } restarts when it is done. The original Thunderbird profile is not changed.
amail-import-in-use = That profile is open in Thunderbird. Close Thunderbird and try again.
amail-import-copying = Copying the profile… This can take a while for large mailboxes.
amail-import-done = Done. Restarting { -brand-short-name }…
amail-import-failed = The import failed: { $message }
amail-import-cancel = Cancel
amail-import-start = Import and restart
amail-import-menu =
    .label = Import full Thunderbird profile…
amail-import-settings-legend = Import from Thunderbird
amail-import-settings-description = Replace this profile with a complete copy of a Thunderbird or Betterbird profile.
amail-import-settings-button =
    .label = Import full Thunderbird profile…

## Message list header

amail-list-sort = Sort
    .title = Sort order and grouping of the message list
## Reading pane subject bar

amail-reader-previous =
    .title = Previous message (B)
    .aria-label = Previous message
amail-reader-next =
    .title = Next message (F)
    .aria-label = Next message

## Split buttons in the command bar

amail-split-write-message =
    .title = More ways to create: event, contact
    .aria-label = More create options
amail-split-get-messages =
    .title = Get messages for one account
    .aria-label = Get messages for one account
amail-new-message =
    .label = New message
    .acceltext = Ctrl+N
amail-new-event =
    .label = New event
    .acceltext = Ctrl+I
amail-new-contact =
    .label = New contact

## Saved sort orders (Sort menu)

amail-sort-save =
    .label = Save current sort…
amail-sort-saved =
    .label = Saved sorts
amail-sort-save-title = Save sort order
amail-sort-save-message = Name for the current sort order (column, direction and grouping):
amail-sort-apply-here =
    .label = Apply to this folder
amail-sort-apply-folders =
    .label = Apply to folders…
amail-sort-delete =
    .label = Delete
amail-sort-apply-title = Apply sort order
# $name - name of the saved sort order
amail-sort-apply-heading = Apply “{ $name }” to folders
amail-sort-apply-intro = Choose the folders that should use this sort order.
amail-sort-apply-filter =
    .placeholder = Filter folders
amail-sort-apply-subfolders = Include subfolders
amail-sort-apply-select-all = Select all
amail-sort-apply-select-none = Clear
amail-sort-apply-button = Apply
# $count - number of selected folders
amail-sort-apply-count =
    { $count ->
        [one] 1 folder selected
       *[other] { $count } folders selected
    }

## Message list header

amail-list-columns = Select columns
    .title = Choose the columns shown in the message list
amail-list-compact = Compact
    .title = One line per message
amail-list-conversations = Conversations
    .title = Group messages into conversations
amail-column-lock =
    .label = Lock column width
amail-list-run-filters = Run filters
    .title = Run the account's filters on this folder

## Search index status (top bar)

# $folder - folder being indexed, $percent - progress in that folder
amail-index-status = Indexing { $folder } · { $percent } %
    .title = Building the search index: { $folder } ({ $percent } %)

## Reading pane empty state

amail-reader-empty = Select an item to read
amail-reader-empty-sub = Nothing is selected

## Mailing list row in the message header

# $domain - the sender's domain, e.g. owlcat.games
amail-list-newsletter-from = Newsletter from { $domain }
amail-list-newsletter = Newsletter
amail-list-unsubscribe = Unsubscribe
    .title = Unsubscribe from this mailing list

## Message header date

# $time - the time the message arrived today, e.g. 10.18
amail-date-today = Today at { $time }

## Settings dialog

amail-settings-title = Settings
amail-settings-accounts-title = Account settings
amail-settings-back =
    .title = Back to Settings
    .aria-label = Back to Settings
amail-settings-close =
    .title = Close (Esc)
    .aria-label = Close settings
amail-settings-filters = Message filters
amail-settings-trusted-senders = Trusted senders
amail-settings-about = About { -brand-short-name }
