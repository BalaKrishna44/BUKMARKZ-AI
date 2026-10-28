from django.core.management.base import BaseCommand
from django.utils import timezone

from bookmarks.embeddings import EMBEDDING_MODEL, EmbeddingError, build_text, embed_texts
from bookmarks.models import Bookmark


class Command(BaseCommand):
    help = ('Generate embeddings for bookmarks that have none (existing data, imports, '
            'or saves made while OpenAI was unreachable). Use --all to re-embed everything.')

    def add_arguments(self, parser):
        parser.add_argument('--all', action='store_true', help='Re-embed every bookmark')
        parser.add_argument('--batch-size', type=int, default=100)

    def handle(self, *args, **options):
        queryset = Bookmark.objects.exclude(category__private=True).select_related('category')   # private can be NULL on old rows
        if not options['all']:
            queryset = queryset.filter(embedding__isnull=True)

        total = queryset.count()
        self.stdout.write('Embedding %d bookmarks with %s' % (total, EMBEDDING_MODEL))
        done = 0
        batch_size = options['batch_size']

        ids = list(queryset.values_list('id', flat=True))
        for start in range(0, len(ids), batch_size):
            batch = list(Bookmark.objects.filter(id__in=ids[start:start + batch_size]).select_related('category'))
            try:
                vectors = embed_texts([build_text(b.name, b.url, b.description) for b in batch])
            except EmbeddingError as exc:
                self.stderr.write('Stopped: %s (run again to continue where it left off)' % exc)
                break
            now = timezone.now()
            for bookmark, vector in zip(batch, vectors):
                bookmark.embedding = vector
                bookmark.embedding_model = EMBEDDING_MODEL
                bookmark.embedded_at = now
            Bookmark.objects.bulk_update(batch, ['embedding', 'embedding_model', 'embedded_at'])
            done += len(batch)
            self.stdout.write('  %d / %d' % (done, total))

        self.stdout.write(self.style.SUCCESS('Done: %d embedded' % done))
