from django.core.management.base import BaseCommand
from django.utils import timezone

from accounts.models import PasskeyChallenge


class Command(BaseCommand):
    help = 'Delete passkey challenges that expired without being used (run hourly from cron: `python manage.py purge_passkey_challenges`).'

    def handle(self, *args, **options):
        deleted, _ = PasskeyChallenge.objects.filter(expires__lt=timezone.now()).delete()
        self.stdout.write(self.style.SUCCESS('Deleted %d expired passkey challenges' % deleted))
