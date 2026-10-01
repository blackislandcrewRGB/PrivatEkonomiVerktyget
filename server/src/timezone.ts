/**
 * The tool's calendar is Swedish: 'today', the month and the crons are
 * Stockholm's, whatever time zone the machine runs in (a server in UTC would
 * otherwise have yesterday from 00 to 02 at night). Imported first by the
 * entry point; Node picks up a TZ set at runtime. TZ given from outside wins.
 */
process.env.TZ ||= "Europe/Stockholm";
