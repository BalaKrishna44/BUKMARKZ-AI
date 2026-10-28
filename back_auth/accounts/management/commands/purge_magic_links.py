from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from accounts.models import MagicLink


class Command(BaseCommand):
    help = 'Delete magic links that are used or expired (run daily from cron: `python manage.py purge_magic_links`).'

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(days=1)
        deleted, _ = MagicLink.objects.filter(expires__lt=cutoff).delete()
        self.stdout.write(self.style.SUCCESS('Deleted %d expired magic links' % deleted))
