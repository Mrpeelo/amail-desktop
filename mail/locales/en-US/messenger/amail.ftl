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
amail-sort-save-columns = Save columns too (shown columns, their order and widths)
amail-sort-overwrite-title = Overwrite sort order?
# $name - name of the saved sort order
amail-sort-overwrite-message = A sort order named “{ $name }” already exists. Overwrite it? Choose No to give it another name.
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
amail-settings-all-title = All settings
amail-settings-all =
    .title = Every { -brand-short-name } option, by category

## Settings page tabs

amail-settings-tab-general = General
amail-settings-tab-accounts = Accounts
amail-settings-tab-signatures = Signatures & templates
amail-settings-tab-trusted = Trusted senders
amail-settings-tab-filters = Filters
amail-settings-tab-about = About
amail-settings-all-link = All settings

## Settings: General

amail-settings-appearance = Appearance
amail-settings-theme-mode = Theme
amail-settings-theme-light =
    .label = Light
amail-settings-theme-dark =
    .label = Dark
amail-settings-theme-system =
    .label = Follow Windows
amail-settings-palette = Colors
amail-settings-palette-amail =
    .label = aMail (white and blue)
amail-settings-palette-synthwave =
    .label = Synthwave
amail-settings-palette-thunderbird =
    .label = Thunderbird
amail-settings-new-mail = New mail
amail-settings-new-mail-alert = Show a notification
amail-settings-new-mail-sound = Play a sound
amail-settings-new-mail-badge = Show the unread count on the taskbar button
amail-settings-new-mail-tray = Show an icon in the notification area
amail-settings-mark-read = Mark as read
amail-settings-mark-read-intro = When a message you open in the reading pane is marked as read.
amail-settings-mark-read-mode = Mark the selected message as read
amail-settings-mark-read-now =
    .label = Immediately
amail-settings-mark-read-after =
    .label = After a delay
amail-settings-mark-read-never =
    .label = Never (only by hand)
amail-settings-mark-read-secs = Seconds
amail-settings-junk = Junk
amail-settings-junk-marks-read = Mark messages as read when I mark them as junk
amail-settings-junk-intro = The junk filter learns from you every time you use Junk or Not junk. Junk folders and filtering are set per account.
amail-settings-junk-accounts = Junk settings per account…

## Settings: Accounts

amail-settings-accounts-none = No accounts yet.
amail-settings-edit = Edit
amail-settings-remove = Remove
amail-settings-delete = Delete
amail-settings-add-account = Add account
amail-settings-import = Import from Thunderbird / Betterbird…
amail-settings-account-default = Default

## Settings: Signatures & templates

amail-settings-signatures = Signatures
amail-settings-signatures-intro = Each address can have several signatures: pick one for new messages and one for replies and forwards. Plain text keeps its line breaks; HTML also works. Changes are saved as you type.
amail-settings-signatures-none = No signatures yet.
amail-settings-signature-name =
    .placeholder = Name, e.g. Work
    .aria-label = Signature name
amail-settings-signature-add = Add signature
# $n - the number of the new signature, e.g. 2
amail-settings-signature-default-name = Signature { $n }
amail-settings-signature-none = No signature
amail-settings-signature-for-new = For new messages
amail-settings-signature-for-replies = For replies and forwards
# $path - the file the signature is read from
amail-settings-signature-file = This address uses a signature file instead: { $path }
amail-settings-templates = Templates
amail-settings-templates-intro = Save a message as a template from the compose window: Templates ▾ ▸ Save this message as a template.
amail-settings-templates-none = No templates yet.
amail-settings-no-subject = (no subject)

## Settings: Trusted senders

amail-settings-trusted-intro = Remote images load automatically for these senders; image sites load in any message. Use the image banner on a message to add one.
amail-settings-trusted-none = Nothing trusted yet.
amail-settings-trusted-search =
    .placeholder = Search trusted senders and sites
amail-settings-trusted-no-match = No trusted sender or site matches the search.
# $count - number of trusted entries
amail-settings-trusted-count = { $count ->
    [one] 1 entry
   *[other] { $count } entries
  }
# $shown - entries matching the search, $count - all entries
amail-settings-trusted-count-filtered = { $shown } of { $count }
amail-settings-trusted-sender = Sender
amail-settings-trusted-domain = Domain
amail-settings-trusted-site = Image site
amail-settings-trusted-more = Blocked senders and sites…

## Settings: Filters

amail-settings-filters-intro = Filters sort new mail as it arrives, in the order listed.
amail-settings-filters-none = No filters yet.
amail-settings-new-filter = New filter
amail-settings-filters-manager = Filter manager (order, run now, log)…
# $name - the filter's name
amail-settings-filter-delete-confirm = Delete the filter “{ $name }”?
amail-settings-filter-enabled =
    .aria-label = Enabled

## Settings: About

# $version - the application version, e.g. 153.7.1
amail-settings-about-version = { -brand-short-name } { $version }, built on Thunderbird
amail-settings-about-data = Everything { -brand-short-name } stores (accounts, mail, settings) is in:
amail-settings-about-open-folder = Open folder
amail-settings-about-details = More about { -brand-short-name }…

## Undo send

amail-settings-undo-send = Undo send
amail-settings-undo-send-intro = Sent messages wait this long before they go out, so you can still cancel them. A countdown with “Cancel sending” appears at the bottom of the window.
amail-settings-undo-send-delay = Wait before sending
amail-settings-undo-send-off = Off (send right away)
# $seconds - the delay, e.g. 60
amail-settings-undo-send-seconds = { $seconds ->
    [one] { $seconds } second
   *[other] { $seconds } seconds
}
# $seconds - seconds left, e.g. 57
amail-undo-send-countdown = Sending in { $seconds } s
amail-undo-send-cancel = Cancel sending

## Inline compose

amail-compose-subject =
    .placeholder = Add a subject
# $time - when the draft was saved, e.g. 21.01
amail-compose-draft-saved = Draft saved { $time }
amail-compose-popout =
    .title = Open in a separate window
    .aria-label = Open in a separate window
amail-compose-signature =
    .label = Signature
    .tooltiptext = Insert or change the signature
amail-compose-signature-none =
    .label = No signature
amail-compose-signature-manage =
    .label = Manage signatures…
amail-compose-templates =
    .label = Templates
    .tooltiptext = Use a template, or save this message as one
# $name - the template's subject
amail-compose-template-use =
    .label = Use “{ $name }”
amail-compose-template-use-untitled =
    .label = Use template (no subject)
amail-compose-templates-none =
    .label = No templates yet
amail-compose-template-save =
    .label = Save this message as a template…
amail-compose-close =
    .title = Close this message (asks to save changes)
    .aria-label = Close this message

amail-menu-events =
    .label = Events
    .accesskey = n

## Message list header count

# $count - unread messages in the folder
amail-list-unread-count = { $count } unread
# $count - messages in the folder
amail-list-message-count = { $count }

## Remote content banner (reading pane)

amail-remote-blocked = To protect your privacy, remote images in this message were blocked.
amail-remote-show = Show images
# $name - a sender's address or a domain
amail-remote-always = Always from { $name }

## Reading pane: conversation strip

# $count - messages in the conversation
amail-reader-conversation = { $count } messages in this conversation

## Reading pane: invitation card

# $name - the organizer's name or address
amail-invite-organizer = Organizer: { $name }

## Search server (global search results)

amail-server-search-button = Search server
    .title = Search the mail servers too, including mail whose text was not downloaded
amail-server-search-empty = No results in the downloaded mail. Try the server:
# $query - the search text
amail-server-search-title = Server results for “{ $query }”
