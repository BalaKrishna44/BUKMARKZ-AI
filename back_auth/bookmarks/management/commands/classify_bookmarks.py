from collections import defaultdict

from django.core.management.base import BaseCommand

from bookmarks import classify
from bookmarks.models import Bookmark


class Command(BaseCommand):
    help = ('Tag and categorise bookmarks that have not been classified yet (existing data, imports, '
            'or saves where the AI was unreachable). Run it from cron every few minutes, e.g. '
            '`*/10 * * * * python manage.py classify_bookmarks --limit 100`.')

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=200, help='Most bookmarks to process in this run (cost guard)')
        parser.add_argument('--user', help='Only this username')
        parser.add_argument('--reclassify', action='store_true', help='Include bookmarks that were already classified')

    def handle(self, *args, **options):
        if not classify.is_enabled():
            self.stderr.write('Classification is off. Set CLASSIFIER_ENABLED=1 and the provider API key.')
            return

        queryset = (Bookmark.objects
                    .exclude(category__private=True)        # private can be NULL on old rows
                    .select_related('category__user')
                    .order_by('id'))
        if not options['reclassify']:
            queryset = queryset.filter(classified_at__isnull=True)
        if options['user']:
            queryset = queryset.filter(category__user__username=options['user'])

        todo = list(queryset[:options['limit']])
        self.stdout.write('Classifying %d bookmarks with %s (%s)' % (len(todo), classify.model_name(), classify.provider()))

        by_user = defaultdict(list)          # categories differ per person, so one request never mixes users
        for bookmark in todo:
            by_user[bookmark.category.user_id].append(bookmark)

        done = 0
        for user_bookmarks in by_user.values():
            for start in range(0, len(user_bookmarks), classify.BATCH_SIZE):
                chunk = user_bookmarks[start:start + classify.BATCH_SIZE]
                try:
                    done += classify.classify_bookmarks(chunk)
                except classify.ClassificationError as exc:
                    self.stderr.write('Stopped: %s (run again to continue where it left off)' % exc)
                    self.stdout.write(self.style.WARNING('Done so far: %d classified' % done))
                    return
                self.stdout.write('  %d / %d' % (done, len(todo)))

        self.stdout.write(self.style.SUCCESS('Done: %d classified' % done))
