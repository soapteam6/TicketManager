using System;

namespace Ais.TicketReview
{
    public sealed partial class ReviewApi
    {
        private static readonly TimeZoneInfo AttendanceTimeZone = TimeZoneInfo.FindSystemTimeZoneById("Pacific Standard Time");
        private static bool AttendanceIsOpen(DateTimeOffset eventTime, DateTimeOffset now)
        {
            return TimeZoneInfo.ConvertTime(now, AttendanceTimeZone).Date >= TimeZoneInfo.ConvertTime(eventTime, AttendanceTimeZone).Date;
        }
    }
}
