-- What waits on a person is called what every desktop calls it.
alter table notices rename to notifications;
alter index notices_newest rename to notifications_newest;
