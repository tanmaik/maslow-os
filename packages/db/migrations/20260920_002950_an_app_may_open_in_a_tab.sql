-- Whether an app opens in a browser tab of its own rather than as a window
-- on the desktop: its owner's choice, made where they publish it.
alter table published_apps add column tab boolean not null default false;
